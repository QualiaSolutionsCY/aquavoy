-- Mail accounts: one row per SMTP/IMAP mailbox. Holds plaintext passwords, so
-- it is locked to the service role — RLS is enabled with NO policies, meaning
-- the anon/authenticated keys can read nothing. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY touches this table.

create table if not exists public.mail_accounts (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  display_name  text,
  smtp_host     text not null,
  smtp_port     int  not null default 465,
  imap_host     text,
  imap_port     int  default 993,
  username      text not null,
  password      text not null,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.mail_accounts is
  'SMTP/IMAP credentials for company mailboxes. Service-role only (holds passwords).';

-- Case-insensitive unique index on email.
create unique index if not exists mail_accounts_email_unique on public.mail_accounts (lower(email));

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.mail_accounts enable row level security;

-- Reuse the shared updated_at trigger function (create or replace so this
-- migration is independently runnable even if 0001 hasn't been applied).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_mail_accounts_updated_at on public.mail_accounts;
create trigger trg_mail_accounts_updated_at
  before update on public.mail_accounts
  for each row execute function public.set_updated_at();
