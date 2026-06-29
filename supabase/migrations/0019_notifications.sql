-- Notification preferences + notification log for M6 Phase 6 (ADR-008).
-- Stores per-principal push subscription, event opt-in, and quiet hours
-- for the web-push MVP channel. notification_log is a 90-day audit trail of
-- every send attempt — the 90-day window is enforced at query time via
-- `sent_at >= now() - interval '90 days'` (no DB cron, matching the
-- project-wide no-DB-cron convention).
--
-- RLS justification: this project has NO Supabase Auth — the principal is
-- carried in a signed HMAC cookie (src/lib/auth/session.ts), not auth.uid().
-- A principal-scoped RLS *policy* is therefore impossible (there is no DB-level
-- identity to match). Following the project-wide pattern (every table from
-- 0004_chat_messages.sql through 0018_processed_messages.sql), these tables
-- are service-role-only: RLS enabled with NO policies. The principal CHECK
-- constraint enforces the valid-operator
-- set at the schema level. Every route scopes its query via supabaseAdmin() +
-- .eq("principal", principal), exactly like /api/actions/route.ts:21.
-- Applied via CI/Supabase flow — never hand-applied to a remote (constitution).

create table if not exists public.notification_preferences (
  id                  uuid        primary key default gen_random_uuid(),
  principal           text        not null check (principal in ('Wency', 'Jeanette')) unique,
  channel             text        not null default 'webpush',
  enabled_events      jsonb       not null default '["stage"]'::jsonb,
  quiet_hours_start   time,
  quiet_hours_end     time,
  push_subscription   jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-principal push subscription + event opt-in + quiet hours for web-push notifications (M6, ADR-008). Service-role only (RLS on, no policies); principal CHECK enforces REQ-3 at schema level. Quiet-hours wrap-midnight logic lives in code (src/lib/notify/preferences.ts). Applied via CI, never hand-applied (constitution).';

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.notification_preferences enable row level security;

-- --------------------------------------------------------------------------

create table if not exists public.notification_log (
  id          uuid        primary key default gen_random_uuid(),
  principal   text        not null check (principal in ('Wency', 'Jeanette')),
  channel     text,
  event       text,
  sent_at     timestamptz not null default now(),
  error       text,
  metadata    jsonb
);

comment on table public.notification_log is
  '90-day audit log of every notification send attempt (M6, ADR-008). Queried with sent_at >= now() - interval ''90 days'' at read time — no DB cron. Service-role only (RLS on, no policies); principal CHECK enforces REQ-3 at schema level. Applied via CI, never hand-applied (constitution).';

-- Principal-scoped recency-ordered audit reads.
create index if not exists idx_notification_log_principal_sent_at
  on public.notification_log (principal, sent_at);

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.notification_log enable row level security;
