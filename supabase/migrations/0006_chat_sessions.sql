-- Chat sessions: "New chat" starts a fresh thread without deleting history.
-- Each message belongs to a session; the UI hydrates only the latest session,
-- while recall_memory searches across ALL sessions (cross-thread memory).

alter table public.chat_messages
  add column if not exists session_id uuid not null default gen_random_uuid();

-- Collapse pre-session rows into a single thread per principal so existing
-- conversations appear as one session rather than one-session-per-message.
with s as (
  select distinct on (principal) principal, session_id
  from public.chat_messages
  order by principal, created_at desc
)
update public.chat_messages cm
set session_id = s.session_id
from s
where cm.principal = s.principal;

create index if not exists idx_chat_messages_principal_session
  on public.chat_messages (principal, session_id, created_at);
