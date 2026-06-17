---
phase: 1
milestone: 2
archetype: ai-agent
profile: standard
scoped_by: Moayad
scoped_at: 2026-06-16
decision_ref: ADR-002
---

# Phase 1 — Durable Memory · Scope

**Goal:** Recall is reliable across long histories, not just keyword-grep over recent messages.

**Approach (locked, ADR-002):** memory formation (extract key facts) + 3-signal hybrid recall
(semantic ⊕ keyword ⊕ recency), in-stack on Supabase + the existing LLM provider. Embedding
behind an adapter. No new service.

## v1 capability set

1. A `memory_facts` store: discrete extracted facts/decisions per session, embedded, principal-scoped.
2. A fact-extraction + summary step that runs on session close ("New chat") + a cron sweep, idempotent.
3. An embedding adapter (`lib/embeddings/`) — provider chosen by config (Gemini via existing key if funded).
4. A hybrid recall ranker: cosine similarity ⊕ lexical hit ⊕ recency decay ⊕ importance → top-K.
5. Both recall paths rewired to the ranker: `autoRecall` (server inject) + `recall_memory` (tool), tool contract unchanged.

## Definition of Done (ai-agent archetype, this phase)

| DoD area | Resolution |
|---|---|
| RLS on every table | `memory_facts`: RLS on, no policies → service-role only (matches existing pattern). |
| pgvector if RAG | Enabled in migration `0009`; this phase is the RAG-over-own-history case. |
| Migrations in VC | New migration file only; applied via CI/Supabase flow, never hand-applied (constitution). |
| Tools validated server-side | `recall_memory` + extraction run server-side; principal from session (ADR-001), never from input. |
| Idempotency on writes | Fact extraction is idempotent per session (re-run does not duplicate facts). |
| Retrieval quality checked | Eval cases below — not assumed. |
| Cost ceiling | Embedding call cost logged; cheap tier; negligible at 2-op scale. |
| Principal isolation (REQ-3) | `principal` column + service-role scoping; cross-principal read returns nothing. |
| Provider not hardcoded | Embedding behind `lib/embeddings/` adapter; provider via config. |
| Dual-path preserved | Both `autoRecall` and `recall_memory` use the ranker; tool signature unchanged. |

## Acceptance criteria (testable)

- **AC1 — Paraphrase recall:** Given a stored fact phrased differently from the query, hybrid
  recall returns it; the old `ilike`-only path returns nothing for the same pair. *(Seam test
  with a stubbed embedding returning a near vector; eval case documented.)*
- **AC2 — Ranking:** The ranker orders candidates by `f(similarity, lexical, recency_decay,
  importance)`; given fixed scores the ordering is deterministic. *(Unit test on the ranker.)*
- **AC3 — No regression:** `recall_memory` keeps its current input/output contract; the existing
  `onedriveTools.test.ts` memory mock still passes; `autoRecall` still returns a string|null.
- **AC4 — Principal isolation:** Recall for principal A never returns a `memory_facts` row whose
  `principal` is B. *(Seam test with two principals.)*
- **AC5 — Extraction idempotency:** Running extraction twice over the same closed session does not
  duplicate facts (upsert keyed on session + fact identity). *(Seam test.)*
- **AC6 — Schema/security:** Migration `0009` enables `pgvector`, creates `memory_facts` with RLS
  enabled and no anon/authenticated policies; `principal` check constraint present. *(Migration
  assertion / contract check.)*
- **AC7 — Type + suite green:** `npx tsc --noEmit` exits 0; `vitest run` passes (existing + new).

## Verification note (env-gated)

Live verification (apply migration to Supabase, run a real embedding + real recall) is **deferred
until env is available** — no `.env.local`/Supabase connection in this session. Build-time gates
(tsc, vitest with mocked seams, migration file inspection) run now; live smoke runs at ship/with env.

## Gate

- [x] v1 capability set scoped
- [x] zero `[NEEDS CLARIFICATION]` markers (embedding provider resolved via adapter + config)
- [x] every DoD area resolved (none waived)
