-- Durable memory: discrete extracted facts/decisions per session, embedded for
-- semantic recall (ADR-002, M2 Phase 1). This is the "memory formation" store —
-- the agent recalls these facts via a 3-signal hybrid ranker (semantic ⊕ lexical
-- ⊕ recency, plus importance), replacing the old chat_messages substring grep.
-- Like every other table (see 0004_chat_messages.sql, 0007_scheduled_emails.sql)
-- it is locked to the service role: RLS is enabled with NO policies, so the
-- anon/authenticated keys can read nothing. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY touches this table. The principal check constraint
-- enforces REQ-3 isolation at the schema level. Applied via CI/Supabase flow —
-- never hand-applied to a remote (constitution).

-- pgvector: required for the embedding column + cosine ANN search.
create extension if not exists vector;

create table if not exists public.memory_facts (
  id          uuid        primary key default gen_random_uuid(),
  principal   text        not null check (principal in ('Wency', 'Jeanette')),
  session_id  uuid        not null,
  fact        text        not null,
  summary     text,
  embedding   vector(768),
  importance  int         not null default 1 check (importance between 1 and 5),
  created_at  timestamptz not null default now(),
  -- Idempotent extraction: re-running over the same closed session upserts on
  -- this key rather than duplicating facts.
  constraint memory_facts_session_fact_uniq unique (session_id, fact)
);

comment on table public.memory_facts is
  'Extracted, embedded memory facts per principal for hybrid recall. Service-role only (RLS on, no policies).';

-- Recency ranking + principal-scoped fetch.
create index if not exists idx_memory_facts_principal_created_at
  on public.memory_facts (principal, created_at);

-- Cosine ANN index for the semantic-similarity signal of the hybrid ranker.
create index if not exists idx_memory_facts_embedding
  on public.memory_facts using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.memory_facts enable row level security;
