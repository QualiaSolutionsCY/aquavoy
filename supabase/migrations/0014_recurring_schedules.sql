-- Recurring schedules: let a scheduled email (0007) or scheduled task (0013)
-- repeat instead of firing once. Two additive columns per table, no data loss,
-- no drops — every existing row keeps its current one-shot behaviour because
-- `recurrence` defaults to 'none'. Like 0007/0013 these tables are service-role
-- only (RLS on, no policies), so RLS/grants are unchanged here.
--   * recurrence       — none/daily/weekly/monthly. 'none' = today's fire-once
--                        behaviour. The runner advances scheduled_at and re-queues
--                        (status back to 'pending') for the non-'none' values.
--   * recurrence_until — optional cap (timestamptz). When set, the next occurrence
--                        is only re-queued if it falls at/before this instant;
--                        otherwise the row finalizes as 'sent'.
-- See src/lib/scheduleRecurrence.ts for the next-occurrence semantics (monthly
-- clamps to the last day of the target month).

alter table public.scheduled_emails
  add column if not exists recurrence text not null default 'none',
  add column if not exists recurrence_until timestamptz;

alter table public.scheduled_emails
  add constraint scheduled_emails_recurrence_check
  check (recurrence in ('none','daily','weekly','monthly'));

alter table public.scheduled_tasks
  add column if not exists recurrence text not null default 'none',
  add column if not exists recurrence_until timestamptz;

alter table public.scheduled_tasks
  add constraint scheduled_tasks_recurrence_check
  check (recurrence in ('none','daily','weekly','monthly'));
