-- OneDrive connections: one row per Microsoft account that granted delegated
-- access. Holds OAuth tokens, so it is locked to the service role — RLS is
-- enabled with NO policies, meaning the anon/authenticated keys can read
-- nothing. Only server code using SUPABASE_SERVICE_ROLE_KEY touches this table.

create extension if not exists "pgcrypto";

create table if not exists public.onedrive_connections (
  id                       uuid primary key default gen_random_uuid(),
  ms_user_id               text not null unique,
  ms_user_principal_name   text,
  display_name             text,
  access_token             text not null,
  refresh_token            text not null,
  scope                    text,
  token_type               text not null default 'Bearer',
  expires_at               timestamptz not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.onedrive_connections is
  'Delegated OAuth tokens for OneDrive/Microsoft Graph. Service-role only.';

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.onedrive_connections enable row level security;

-- Keep updated_at fresh on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_onedrive_connections_updated_at on public.onedrive_connections;
create trigger trg_onedrive_connections_updated_at
  before update on public.onedrive_connections
  for each row execute function public.set_updated_at();
