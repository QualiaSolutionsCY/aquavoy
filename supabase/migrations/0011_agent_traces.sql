-- Agent traces: per-turn observability for the model tool loop (REQ-14, M2).
-- Each row is one agent turn — which principal asked, which model/provider
-- served it, the tool calls it made (name + summarized args/result + per-call
-- latency + error), the end-to-end latency, token usage, and any turn-level
-- error. The agent loop writes one row per turn (Task 2) and the metrics API
-- reads them back (Task 2). Like every other table (see 0010_pending_actions.sql,
-- 0009_memory_facts.sql) it is locked to the service role: RLS is enabled with
-- NO policies, so anon/authenticated keys can read nothing — only server code
-- using SUPABASE_SERVICE_ROLE_KEY touches it. The principal check constraint
-- enforces REQ-3 isolation at the schema level; the provider check matches the
-- two real providers resolved in src/lib/openrouter/client.ts ('gemini' when
-- GOOGLE_API_KEY is set, else 'openrouter').
-- Applied via CI/Supabase flow — never hand-applied to a remote (constitution).

create table if not exists public.agent_traces (
  id                uuid        primary key default gen_random_uuid(),
  principal         text        not null check (principal in ('Wency', 'Jeanette')),
  model             text        not null,
  provider          text        not null check (provider in ('openrouter', 'gemini')),
  tool_calls        jsonb       not null default '[]'::jsonb,
  latency_ms        integer     not null,
  prompt_tokens     integer     not null default 0,
  completion_tokens integer     not null default 0,
  error             text,
  created_at        timestamptz not null default now()
);

comment on table public.agent_traces is
  'Per-turn agent observability — model/provider, tool calls, latency, token usage, errors (REQ-14, M2). Service-role only (RLS on, no policies); principal check enforces REQ-3 at the schema level. Applied via CI, never hand-applied (constitution).';

-- Principal-scoped fetch of traces for the metrics surface, recency-ordered.
create index idx_agent_traces_principal_created
  on public.agent_traces (principal, created_at);

-- RLS on, no policies → inaccessible to anon/authenticated roles.
alter table public.agent_traces enable row level security;
