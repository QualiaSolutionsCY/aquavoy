-- Idempotency table for inbox ingestion (REQ-29). The cron that fetches and
-- stages emails runs on a schedule and may overlap or retry. Without this
-- guard a retried run would re-stage the same message, creating duplicate
-- pending_actions rows. Key = (mailbox, uid) which is the IMAP unique ID within
-- a mailbox folder — once a message is processed it is permanently recorded here
-- and any subsequent cron pass skips it.
-- message_id captures the RFC-2822 Message-ID header for cross-mailbox dedup.
-- category records what the classifier decided so retries can skip re-classification.
-- Like 0015/0017 this table is locked to the service role — RLS is enabled with
-- NO policies, so the anon/authenticated keys can read nothing. Only server code
-- using SUPABASE_SERVICE_ROLE_KEY touches it (via src/lib/mail/processedMessages.ts).
-- markProcessed() MUST commit before the downstream pending_actions insert so
-- that a crash between the two operations results in a harmless duplicate guard
-- rather than a silent double-stage on retry.

create table if not exists public.processed_messages (
  id           uuid primary key default gen_random_uuid(),
  mailbox      text not null,
  uid          integer not null,
  message_id   text,
  category     text not null,
  processed_at timestamptz not null default now(),
  constraint processed_messages_mailbox_uid_unique unique (mailbox, uid)
);

comment on table public.processed_messages is
  'Idempotency store for inbox ingestion (REQ-29): each (mailbox, uid) pair is recorded before staging so cron retries and overlapping runs never double-stage the same email. Service-role only (RLS on, no policies).';

-- Supports cleanupProcessed() which deletes rows older than N days.
create index if not exists processed_messages_processed_at_idx
  on public.processed_messages (processed_at);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.processed_messages enable row level security;
