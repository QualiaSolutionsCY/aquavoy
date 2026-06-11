-- Recipients: the people the CrewAI automation prepares 1:1 emails for. Not
-- secret like tokens, but with no app-auth layer yet we keep it service-role
-- only (RLS on, no policies), accessed exclusively through server routes.
-- When app auth lands, add an owner_id + a policy on auth.uid().

create extension if not exists "pgcrypto";

create table if not exists public.recipients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  role        text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.recipients is
  'People the Aquavoy/CrewAI automation prepares personalized 1:1 emails for.';

create unique index if not exists recipients_email_unique
  on public.recipients (lower(email));

alter table public.recipients enable row level security;

-- Reuse the shared updated_at trigger function (created in 0001). Define it
-- here too with CREATE OR REPLACE so this migration is independently runnable.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_recipients_updated_at on public.recipients;
create trigger trg_recipients_updated_at
  before update on public.recipients
  for each row execute function public.set_updated_at();
