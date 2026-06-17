-- Pending actions: the stage-and-confirm record for destructive tool calls
-- (ADR-003, M2 Phase 3). Destructive tools (send_email, schedule_email,
-- delete_item, move_item, rename_item) NEVER execute inside the model's tool
-- loop — executeTool stages a row here and returns confirmation_required. The
-- real side-effect runs only via the human-triggered confirm endpoint, which
-- records the result + reversibility back onto this row. This single table IS
-- the audit trail: who (principal), what (tool + args + summary), when
-- (created_at, resolved_at), outcome (status, result). Like every other table
-- (see 0004_chat_messages.sql, 0009_memory_facts.sql) it is locked to the
-- service role: RLS is enabled with NO policies, so anon/authenticated keys can
-- read nothing — only server code using SUPABASE_SERVICE_ROLE_KEY touches it.
-- The principal check constraint enforces REQ-3 isolation at the schema level.
-- Applied via CI/Supabase flow — never hand-applied to a remote (constitution).

create table if not exists public.pending_actions (
  id          uuid        primary key default gen_random_uuid(),
  principal   text        not null check (principal in ('Wency', 'Jeanette')),
  tool        text        not null,
  args        jsonb       not null,
  summary     text        not null,
  status      text        not null default 'pending'
                check (status in ('pending', 'confirmed', 'cancelled', 'undone', 'failed')),
  undo_data   jsonb,
  result      jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.pending_actions is
  'Stage-and-confirm + audit record for destructive actions (M2-P3, ADR-003). Service-role only (RLS on, no policies); principal check enforces REQ-3 at the schema level. Applied via CI, never hand-applied (constitution).';

-- Principal-scoped fetch of pending actions for the UI, recency-ordered.
create index idx_pending_actions_principal_status_created
  on public.pending_actions (principal, status, created_at);

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.pending_actions enable row level security;
