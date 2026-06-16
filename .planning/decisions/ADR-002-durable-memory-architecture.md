# ADR-002 — Durable Memory Architecture (M2 · Phase 1)

**Date:** 2026-06-16
**Status:** Accepted
**Deciders:** Moayad (EMPLOYEE) — research-backed; OWNER ratification on first ship
**Supersedes recall behavior in:** `src/lib/agents/memoryTools.ts`

## Context

Today recall is pure substring matching. `autoRecall` (`memoryTools.ts:61`) extracts
≥5-char words (max 4) and `ilike`-ORs them over `chat_messages`; `recall_memory`
(`memoryTools.ts:20`) does `ilike %query%`. This **misses paraphrases** ("what did we
decide on pricing?" finds nothing if the message said "€40/ton") and **drowns in long
histories** (recency-only, no salience). ROADMAP M2-P1 requires recall that surfaces a
relevant fact from an older session a keyword match would miss, ranked by salience +
recency, while preserving the dual-path model and the M1 principal-isolation invariant
(REQ-3, ADR-001).

The fork: recall mechanism, the durable memory unit, summarization cadence, embedding
provider.

## Decision

**Memory formation + 3-signal hybrid recall, in-stack (Supabase + existing LLM provider), no new service.**

1. **Recall = hybrid blend:** semantic similarity (pgvector) ⊕ keyword (existing lexical) ⊕
   recency decay, with an importance weight. Matches the production consensus
   (semantic + keyword/BM25 + recency) found in research.
2. **Memory unit = extracted key facts, not whole-conversation summaries.** "Memory
   formation beats summarization" (Mem0, *Chat History Best Practices*, Oct 2025): store
   discrete facts/decisions as embedded rows; a thread-level summary is the container.
3. **Embedding behind an adapter** (`lib/embeddings/`): provider is a config detail, not
   wired into feature code (per `rules/architecture.md` §3 adapters-at-seams and the
   "never hardcode a provider" infra rule). Default provider: Gemini via the existing
   `GOOGLE_API_KEY` path (`client.ts:210`) if funded — zero new keys; else configurable.
4. **Build cadence:** extract facts + summary when a session closes ("New chat" boundary)
   plus a light cron sweep for stragglers. No per-turn latency cost; no Railway worker
   (reuses the existing per-minute cron pattern).
5. **Dual-path preserved:** both `autoRecall` (server auto-inject) and `recall_memory`
   (callable tool) route through the new ranked recall; the tool signature is unchanged.

## Alternatives considered

- **Improved lexical only (Postgres FTS / trigram).** Cheaper, no extension — but synonyms
  and paraphrases still slip through, so it does NOT satisfy the "surfaces a fact a keyword
  misses" criterion. Rejected.
- **Pure semantic (drop lexical).** Simpler one path — but discards a working cheap fallback
  and any not-yet-embedded row goes dark until backfilled. Rejected; keep lexical in the blend.
- **Whole-session summaries as the unit.** Compression loses the specific decision; research
  shows fact extraction beats it on both accuracy and tokens. Rejected as the primary unit
  (summary kept as a container only).
- **Adopt Mem0 (or similar managed memory).** Production-grade, but a heavy external dependency
  + data egress for a two-operator internal tool. Rejected — apply the *principles* in-stack.

## Consequences

- **New migration** (`supabase/migrations/0009_*`): enable `pgvector`; create `memory_facts`
  (`principal` check ∈ {Wency, Jeanette}, `session_id`, `fact`, `summary`, `embedding vector`,
  `importance int`, `created_at`). **RLS enabled, no policies → service-role only** (matches
  every existing table); principal column enforces REQ-3 isolation. Migration applied through
  CI / Supabase flow — never hand-applied (constitution).
- **New seam** `src/lib/embeddings/` owning the embedding provider's wire format; one place to
  swap providers.
- **Embed-on-write:** fact extraction generates an embedding per fact at storage time.
- **New ranker** blending cosine similarity, lexical hit, and recency decay (half-life config).
- **Cost:** one cheap embedding call per stored fact + per recall query; negligible at
  two-operator scale. Logged for the cost-ceiling DoD line.
- **Env:** an embedding provider key — reuse `GOOGLE_API_KEY` if funded, confirmed on env pull;
  otherwise a configured alternative. No code change either way (adapter).
- **Reversible-ish:** the recall ranker is internal; the `recall_memory` tool contract and the
  `autoRecall` injection contract are the stable seams that don't change.
