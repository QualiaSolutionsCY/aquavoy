-- Scheduled tasks / reminders: queue of reminders the agent sets, delivered by
-- email at a future time. A reminder is a SELF-EMAIL — it is sent TO a connected
-- company mailbox (the `mailbox` column) so the team receives it in their inbox.
-- This mirrors scheduled_emails (0007) one-to-one: like mail_accounts (0003) it is
-- locked to the service role — RLS is enabled with NO policies, so the
-- anon/authenticated keys can read nothing. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY touches this table (via src/lib/agents/scheduledTasks.ts).
-- Every column matches/supersets the names that file reads and writes (see the
-- ScheduledTaskRow interface).

create table if not exists public.scheduled_tasks (
  id            uuid primary key default gen_random_uuid(),
  principal     text,
  mailbox       text not null,
  title         text not null,
  notes         text,
  scheduled_at  timestamptz not null,
  status        text not null default 'pending',
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  constraint scheduled_tasks_status_check check (status in ('pending','sent','failed','cancelled'))
);

comment on table public.scheduled_tasks is
  'Queue of agent-set reminders, delivered by email (self-email) at a future time. Service-role only (RLS on, no policies).';

-- Supports the runDueTasks query: pending rows due now, ordered by scheduled_at.
create index if not exists scheduled_tasks_due_idx
  on public.scheduled_tasks (status, scheduled_at);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.scheduled_tasks enable row level security;
