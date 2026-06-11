-- Chat messages: persistent conversation history per principal (Wency / Jeanette).
-- Service-role only — RLS is enabled with NO policies, matching the pattern in
-- 0001_onedrive_connections.sql. The /api/chat/history routes use the service-role
-- client to read and write this table.

create table if not exists public.chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  principal   text        not null check (principal in ('Wency', 'Jeanette')),
  role        text        not null check (role in ('user', 'assistant')),
  content     text        not null,
  created_at  timestamptz not null default now()
);

comment on table public.chat_messages is
  'Persistent chat history per principal. Service-role only.';

-- Fast retrieval of the most recent messages for a given principal.
create index idx_chat_messages_principal_created_at
  on public.chat_messages (principal, created_at);

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.chat_messages enable row level security;
