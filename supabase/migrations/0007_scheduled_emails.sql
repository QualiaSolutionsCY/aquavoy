-- Scheduled emails: queue of outbound emails to send at a future time. The live
-- table was applied out-of-band (the schema drifted ahead of this folder, which
-- held only 0001-0006). This migration tracks it so the repo matches production.
-- Every column here is a match/superset of the column names src/lib/mail/scheduled.ts
-- reads and writes (see the ScheduledRow interface). Like mail_accounts (0003) it
-- is locked to the service role — RLS is enabled with NO policies, so the
-- anon/authenticated keys can read nothing. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY touches this table.

create table if not exists public.scheduled_emails (
  id            uuid primary key default gen_random_uuid(),
  from_email    text not null,
  to_email      text not null,
  subject       text not null,
  body          text not null,
  scheduled_at  timestamptz not null,
  status        text not null default 'pending',
  sent_at       timestamptz,
  error         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  constraint scheduled_emails_status_check check (status in ('pending','sent','failed','cancelled'))
);

comment on table public.scheduled_emails is
  'Queue of outbound emails to send at a future time. Service-role only (RLS on, no policies).';

-- Supports the runDue query: pending rows due now, ordered by scheduled_at.
create index if not exists scheduled_emails_due_idx
  on public.scheduled_emails (status, scheduled_at);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.scheduled_emails enable row level security;
