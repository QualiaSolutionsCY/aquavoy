---
phase: 1
goal: "Recall is reliable across long histories, not just keyword-grep over recent messages."
tasks: 4
waves: 3
---

# Phase 1: Durable Memory

**Goal:** Recall is reliable across long histories — paraphrases surface, salience and recency rank results, both recall paths route through one ranked hybrid recall, and memory stays scoped to the session principal (REQ-3).
**Why this phase:** Today `autoRecall` greps `chat_messages` for ≥5-char word overlaps (`src/lib/agents/memoryTools.ts:61-100`) and `recallMemory` does `ilike %query%` (`memoryTools.ts:20-52`) — both miss paraphrases ("pricing?" never finds "€40/ton") and drown in long histories. This phase replaces substring matching with memory formation (extracted facts) + a 3-signal hybrid ranker, per ADR-002. It unlocks M2's "remember what we decided last week" promise without a new service.

> Architecture is locked by `@.planning/decisions/ADR-002-durable-memory-architecture.md` and `@.planning/phase-1-context.md`. Do not re-litigate. Live verification (real migration apply, real embeddings, real recall) is ENV-GATED and deferred — there is no Supabase connection or `GOOGLE_API_KEY` in this session. Primary validation this phase = `npx tsc --noEmit`, `npx vitest run` (mocked seams), and migration-file inspection.

---

## Task 1 — Migration 0009: pgvector + `memory_facts` table
**Wave:** 1
**Persona:** backend
**Files:** `supabase/migrations/0009_memory_facts.sql` (create)
**Depends on:** none

**Why:** Memory formation needs a durable, embedded, principal-scoped store. ADR-002 §Consequences and AC6 require migration `0009` to enable `pgvector` and create `memory_facts` with RLS enabled, no policies (service-role only — mirroring every existing table), and a `principal` check constraint enforcing REQ-3 isolation. Migration is a file only; it is applied via CI/Supabase flow, never hand-applied (constitution).

**Acceptance Criteria:**
- A new file `supabase/migrations/0009_memory_facts.sql` exists, numbered after `0008` (current latest — confirmed via `ls supabase/migrations/`).
- The migration runs `create extension if not exists vector;` to enable pgvector.
- It creates `public.memory_facts` with columns: `id uuid pk default gen_random_uuid()`, `principal text not null check (principal in ('Wency','Jeanette'))`, `session_id uuid not null`, `fact text not null`, `summary text`, `embedding vector(768)`, `importance int not null default 1 check (importance between 1 and 5)`, `created_at timestamptz not null default now()`.
- A uniqueness key supports idempotent upsert (AC5): `constraint memory_facts_session_fact_uniq unique (session_id, fact)`.
- RLS is enabled with NO policies: `alter table public.memory_facts enable row level security;` and no `create policy` statements.
- Indexes: a btree on `(principal, created_at)` for recency, and an ivfflat (or hnsw) cosine index on `embedding` for similarity search.

**Action:**
1. Read `@supabase/migrations/0004_chat_messages.sql` and `@supabase/migrations/0007_scheduled_emails.sql` and mirror their exact comment style + RLS-on/no-policy pattern.
2. Create `supabase/migrations/0009_memory_facts.sql`. First statement: `create extension if not exists vector;`.
3. Create the `memory_facts` table with the columns and constraints listed in Acceptance Criteria. Use `vector(768)` for the embedding (locked dimension — the embedding adapter in Task 2 requests `output_dimensionality: 768`).
4. Add the unique constraint `memory_facts_session_fact_uniq (session_id, fact)` so re-running extraction upserts rather than duplicates.
5. Add indexes: `create index idx_memory_facts_principal_created_at on public.memory_facts (principal, created_at);` and a cosine ANN index: `create index idx_memory_facts_embedding on public.memory_facts using ivfflat (embedding vector_cosine_ops) with (lists = 100);`.
6. Add a `comment on table` line matching the existing tables' phrasing ("...Service-role only (RLS on, no policies).").
7. Enable RLS as the final statement. Do NOT write any `create policy`.

**Validation:** (builder self-check)
- `test -f supabase/migrations/0009_memory_facts.sql && echo EXISTS` → `EXISTS`
- `grep -c "create extension if not exists vector" supabase/migrations/0009_memory_facts.sql` → `1`
- `grep -c "enable row level security" supabase/migrations/0009_memory_facts.sql` → `1`
- `grep -c "create policy" supabase/migrations/0009_memory_facts.sql` → `0`
- `grep -Ec "principal .* check .*Wency.*Jeanette" supabase/migrations/0009_memory_facts.sql` → `1`
- `grep -c "vector(768)" supabase/migrations/0009_memory_facts.sql` → `1`

**Context:** Read @supabase/migrations/0004_chat_messages.sql @supabase/migrations/0007_scheduled_emails.sql @.planning/decisions/ADR-002-durable-memory-architecture.md @.planning/phase-1-context.md

---

## Task 2 — Embedding adapter (`src/lib/embeddings/`) + env block
**Wave:** 1
**Persona:** architect
**Files:** `src/lib/embeddings/index.ts` (create), `src/lib/embeddings/index.test.ts` (create), `src/lib/env.ts` (modify — add embeddings env block)
**Depends on:** none

**Why:** ADR-002 §3 and the infra rule "never hardcode a provider" require the embedding provider to live behind one adapter (`rules/architecture.md` §3 adapters-at-seams), chosen by config, swappable in one place, and stubable in tests (the project mocks seams — see `@src/lib/agents/onedriveTools.test.ts:24`). This is the seam the ranker and the fact-writer both call; isolating it here keeps provider choice out of feature code.

**Acceptance Criteria:**
- `src/lib/embeddings/index.ts` exports `export async function embedText(text: string): Promise<number[]>` returning a 768-length vector.
- Provider is resolved by config, never hardcoded in callers: a funded `GOOGLE_API_KEY` routes to Gemini's `gemini-embedding-001` `embedContent` endpoint (mirroring the existing Gemini-via-env pattern in `@src/lib/openrouter/client.ts:209-226`); the model id is overridable via `EMBEDDING_MODEL` and the dimension via config.
- `src/lib/env.ts` gains a lazy per-feature `getEmbeddingsEnv()` following the EXACT pattern of `getTavilyEnv()` / `getCryptoEnv()` (Zod schema + cached `validate(...)`), validating the embedding key and optional model/dimension.
- The adapter is unit-testable WITHOUT a network call: the test mocks `fetch` (or the provider call) and asserts `embedText` returns the parsed vector and POSTs the correct request shape.
- `npx tsc --noEmit` exits 0; the new test passes.

**Action:**
1. Read `@src/lib/openrouter/client.ts:182-239` (`buildHeaders`, `GOOGLE_OPENAI_URL`, `chatProvider`) — mirror its "funded GOOGLE_API_KEY → Gemini, else fallback" resolution shape, but for embeddings.
2. Read `@src/lib/env.ts:95-126` (`getTavilyEnv`, `getCryptoEnv`) — copy that lazy-cached Zod pattern exactly. Add:
   ```ts
   const embeddingsSchema = z.object({
     GOOGLE_API_KEY: z.string().min(1, "GOOGLE_API_KEY is required for embeddings"),
     EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-001"),
     EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
   });
   let embeddingsCache: z.infer<typeof embeddingsSchema> | null = null;
   export function getEmbeddingsEnv() {
     return (embeddingsCache ??= validate(embeddingsSchema, "embeddings"));
   }
   ```
3. Create `src/lib/embeddings/index.ts`. Implement `embedText(text)`:
   - Resolve config via `getEmbeddingsEnv()`.
   - POST to `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent` with header `x-goog-api-key: ${GOOGLE_API_KEY}` and `Content-Type: application/json`.
   - Body: `{ "content": { "parts": [{ "text": text }] }, "output_dimensionality": dim }` (verified shape — Gemini `embedContent`).
   - Parse the vector at `json.embedding.values` (single-content response form). If the array length ≠ configured dim, throw a clear error.
   - On non-2xx, throw `Error("Embedding failed: " + status + " " + body)`.
   - Keep this the ONLY file that knows the wire format.
4. Create `src/lib/embeddings/index.test.ts` (vitest): stub `global.fetch` to return `{ embedding: { values: [<768 numbers>] } }`; assert `embedText("hi")` resolves to that array AND that fetch was called with a URL containing `:embedContent` and a body whose `content.parts[0].text === "hi"`. Add a second case: non-2xx fetch → `embedText` rejects.

**Validation:** (builder self-check)
- `npx tsc --noEmit` → exits 0 (no `error TS`)
- `grep -c "export async function embedText" src/lib/embeddings/index.ts` → `1`
- `grep -c "getEmbeddingsEnv" src/lib/env.ts` → `2` (definition + cache line — at least ≥1)
- `grep -c ":embedContent" src/lib/embeddings/index.ts` → `1`
- `npx vitest run src/lib/embeddings/index.test.ts` → passes

**Context:** Read @src/lib/openrouter/client.ts @src/lib/env.ts @src/lib/agents/onedriveTools.test.ts @.planning/decisions/ADR-002-durable-memory-architecture.md

---

## Task 3 — Memory store: fact extraction (embed-on-write) + hybrid ranker + rewire both recall paths
**Wave:** 2
**Persona:** backend
**Files:** `src/lib/agents/memoryStore.ts` (create), `src/lib/agents/memoryStore.test.ts` (create), `src/lib/agents/memoryTools.ts` (modify — rewire `recallMemory` + `autoRecall` to the ranker), `src/lib/agents/onedriveTools.ts` (modify only if the `recall_memory` call site needs no change — verify, do not break the contract)
**Depends on:** Task 1, Task 2

**Why:** This is the core of ADR-002: store discrete extracted facts as embedded rows (memory formation, not whole-session summaries), and replace substring recall with a 3-signal hybrid blend — cosine similarity ⊕ lexical hit ⊕ recency decay, plus an importance weight (AC1, AC2). Both recall paths (`autoRecall` server-inject and the `recall_memory` tool) must route through this ranker (ADR-002 §5) while the `recall_memory` tool's input/output contract stays byte-identical so `@src/lib/agents/onedriveTools.test.ts:24`'s mock still passes (AC3). Principal isolation (AC4 / REQ-3) is enforced by filtering every query on `principal`.

**Acceptance Criteria:**
- `src/lib/agents/memoryStore.ts` exports:
  - `extractFacts(principal, sessionId, messages)` → extracts salient facts/decisions via the LLM seam, embeds each via `embedText`, and UPSERTs into `memory_facts` keyed on `(session_id, fact)` so re-running does not duplicate (AC5).
  - `rankFacts(query, candidates, opts)` → a PURE function that scores each candidate by `score = w_sim·cosine + w_lex·lexicalHit + w_rec·recencyDecay + w_imp·importanceNorm` and returns them sorted descending. Deterministic for fixed inputs (AC2).
  - `hybridRecall(query, principal, limit)` → embeds the query, fetches principal-scoped candidates from `memory_facts`, ranks them with `rankFacts`, returns top-K.
- `recallMemory(query, principal)` in `memoryTools.ts` now calls `hybridRecall` and returns the SAME JSON string shape it returns today (`{ hits: [...] }` or `{ message, hits: [] }` / `{ error }`) — the tool contract is unchanged (AC3). The function signature `(query: string, principal: string): Promise<string>` stays identical.
- `autoRecall(principal, userText)` now calls `hybridRecall` and still returns `string | null` (AC3) — same injection contract used at `@src/app/api/chat/route.ts:46`.
- Every `memory_facts` query is filtered `.eq("principal", principal)` — recall for A never returns a B row (AC4).
- The existing `onedriveTools.test.ts` suite still passes unchanged; new `memoryStore.test.ts` covers AC1 (paraphrase via stubbed near-vector), AC2 (deterministic ordering), AC4 (two-principal isolation), AC5 (idempotent upsert).
- `npx tsc --noEmit` exits 0; `npx vitest run` passes (existing + new).

**Action:**
1. Read `@src/lib/agents/memoryTools.ts` (full), `@src/lib/agents/onedriveTools.ts:225-248` (tool def) and `:665-672` (executor case), `@src/lib/agents/onedriveTools.test.ts` (the `recallMemory` mock at line 24), `@src/app/api/chat/route.ts:40-49` (how `autoRecall`'s return is consumed). The `recall_memory` JSON schema (`query`, `principal`, both required) and the call `return await recallMemory(query, principal)` MUST NOT change — only `recallMemory`'s internals.
2. Create `src/lib/agents/memoryStore.ts`:
   - Import `supabaseAdmin` from `@/lib/supabase/server` and `embedText` from `@/lib/embeddings`.
   - `rankFacts(query, candidates, opts?)`: pure. `cosine(a,b)` over the stored embedding vs the query embedding (caller passes query embedding in via candidate-independent arg or precomputed); `lexicalHit` = 1 if any ≥5-char query word appears in `fact` (reuse the salient-word logic from the old `autoRecall`, `memoryTools.ts:67-75`); `recencyDecay` = `exp(-ageHours / halfLifeHours)` with a configurable half-life (default e.g. 720h ≈ 30d); `importanceNorm` = `importance / 5`. Default weights e.g. `{ sim: 0.5, lex: 0.2, rec: 0.2, imp: 0.1 }` — expose via `opts` for the unit test. Return candidates sorted by score desc; ties broken by `created_at` desc (deterministic).
   - `hybridRecall(query, principal, limit = 8)`: `const qv = await embedText(query);` then `supabaseAdmin().from("memory_facts").select("id, fact, summary, importance, embedding, created_at").eq("principal", principal).limit(200)`; map rows to candidates (parse `embedding` to `number[]`), call `rankFacts(query, candidates, { queryEmbedding: qv })`, slice top-`limit`.
   - `extractFacts(principal, sessionId, messages)`: call the LLM seam to extract a small list of `{ fact, importance }` plus an optional `summary` from the session transcript. Use the existing provider seam — read `@src/lib/openrouter/client.ts` and reuse its chat-completion path (do NOT add a second provider); request a JSON list. For each fact: `embedText(fact)`, then `upsert` into `memory_facts` with `onConflict: "session_id,fact"` so re-runs are idempotent (AC5). Filter to facts only; the summary is stored on the rows' `summary` column (container, per ADR-002 §2).
3. Rewire `memoryTools.ts`:
   - `recallMemory`: replace the `.ilike` block with `const hits = await hybridRecall(query, principal, 20);` then map to the SAME output shape (`role`/`content`/`created_at` → for facts, emit `{ content: fact, created_at }`; keep `{ hits }` / `{ message, hits: [] }` / `{ error }` envelopes identical). Keep signature and return type unchanged.
   - `autoRecall`: replace the salient-word `.or(ilike)` block with `hybridRecall(principal-scoped)`; build the same `Auto-recalled notes...` string from the ranked facts; return `string | null` (null when no facts).
   - Keep `import { hybridRecall } from "@/lib/agents/memoryStore";` at top.
4. Create `src/lib/agents/memoryStore.test.ts` (vitest, mock the seams):
   - `vi.mock("@/lib/embeddings", () => ({ embedText: vi.fn() }))` and `vi.mock("@/lib/supabase/server", ...)` returning a chainable stub.
   - AC1: a stored fact whose embedding is NEAR the query vector but shares NO ≥5-char word ranks above an unrelated fact → returned in top-K (old ilike path would miss it).
   - AC2: `rankFacts` with two candidates of fixed (cosine, lexical, recency, importance) returns a deterministic order; assert exact order.
   - AC4: candidates for principal A only — assert `hybridRecall("q","Wency")` issues `.eq("principal","Wency")` (spy the chain) and never surfaces a Jeanette row.
   - AC5: calling the upsert path twice with the same `(session_id, fact)` calls `upsert` with `onConflict: "session_id,fact"` (spy) — assert no duplicate insert.

**Validation:** (builder self-check)
- `npx tsc --noEmit` → exits 0 (no `error TS`)
- `grep -c "hybridRecall" src/lib/agents/memoryTools.ts` → `2` (used in both `recallMemory` and `autoRecall`)
- `grep -c "ilike" src/lib/agents/memoryTools.ts` → `0` (substring recall removed)
- `grep -c "onConflict" src/lib/agents/memoryStore.ts` → `1` (idempotent upsert)
- `grep -c '.eq("principal"' src/lib/agents/memoryStore.ts` → `≥1` (principal isolation)
- `npx vitest run` → all suites pass (existing `onedriveTools.test.ts` + new `memoryStore.test.ts`)

**Context:** Read @src/lib/agents/memoryTools.ts @src/lib/agents/onedriveTools.ts @src/lib/agents/onedriveTools.test.ts @src/app/api/chat/route.ts @src/lib/openrouter/client.ts @src/lib/supabase/server.ts @.planning/decisions/ADR-002-durable-memory-architecture.md @.planning/phase-1-context.md

---

## Task 4 — Build cadence: cron sweep route for fact extraction
**Wave:** 3
**Persona:** backend
**Files:** `src/app/api/memory/sweep/route.ts` (create), `vercel.json` (modify — add the cron entry), `src/app/api/memory/sweep/route.test.ts` (create)
**Depends on:** Task 3

**Why:** ADR-002 §4 locks the build cadence: extract facts on the "New chat" session-close boundary PLUS a light cron sweep for stragglers — no Railway worker, reusing the existing per-minute Vercel cron pattern (`@vercel.json` + `@src/lib/mail/scheduled.ts` runner). The sweep finds closed sessions that have messages but no `memory_facts` yet and runs `extractFacts` over them, idempotently (AC5), with per-row error isolation matching `runDue` (`scheduled.ts:149-198`).

**Acceptance Criteria:**
- `src/app/api/memory/sweep/route.ts` exports a `GET` handler guarded by `CRON_SECRET` bearer (EXACT pattern of `@src/app/api/mail/scheduled/run/route.ts:14-21`) — returns 401 without the matching bearer.
- The handler finds "stragglers": distinct `(principal, session_id)` in `chat_messages` that are NOT the principal's latest session (closed threads) and have NO rows in `memory_facts`, then calls `extractFacts` per session with per-session try/catch so one failure never aborts the batch (mirrors `runDue`).
- `vercel.json` gains a second cron entry: `{ "path": "/api/memory/sweep", "schedule": "*/5 * * * *" }` (every 5 min — lighter than the mail per-minute drain), and the existing mail cron entry is preserved unchanged.
- Running the sweep twice does not duplicate facts (idempotency carried by Task 3's `(session_id, fact)` upsert).
- `npx tsc --noEmit` exits 0; the sweep route test passes (auth guard + straggler selection logic mocked).

**Action:**
1. Read `@src/app/api/mail/scheduled/run/route.ts` (full — copy the `CRON_SECRET` bearer guard and `runtime`/`dynamic` exports verbatim) and `@src/lib/mail/scheduled.ts:149-198` (`runDue` per-row isolation shape).
2. Create `src/app/api/memory/sweep/route.ts`:
   - `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
   - `GET(req)`: bearer-guard against `process.env.CRON_SECRET`; 401 on mismatch (use `fail` from `@/lib/http` — confirm it exists in the mail run route's imports).
   - Query `chat_messages` via `supabaseAdmin()` for candidate `(principal, session_id)` groups; determine each principal's latest session (most recent `created_at`) and EXCLUDE it (only closed threads). For each remaining session with no existing `memory_facts` row (`select id ... eq session_id ... limit 1`), load its messages and call `extractFacts(principal, sessionId, messages)` inside try/catch; tally `{ processed, failed }`.
   - Return `ok({ processed, failed })`.
3. Modify `vercel.json`: add the memory-sweep cron entry to the `crons` array; keep the mail entry.
4. Create `src/app/api/memory/sweep/route.test.ts` (vitest): mock `@/lib/agents/memoryStore` (`extractFacts: vi.fn()`) and `@/lib/supabase/server`; assert (a) GET without `Bearer ${CRON_SECRET}` → 401 and `extractFacts` NOT called; (b) GET with the correct bearer over a stubbed straggler session → `extractFacts` called once, latest/open session skipped.

**Validation:** (builder self-check)
- `npx tsc --noEmit` → exits 0 (no `error TS`)
- `grep -c "CRON_SECRET" src/app/api/memory/sweep/route.ts` → `1`
- `grep -c "extractFacts" src/app/api/memory/sweep/route.ts` → `≥1`
- `grep -c "/api/memory/sweep" vercel.json` → `1`
- `grep -c "/api/mail/scheduled/run" vercel.json` → `1` (existing cron preserved)
- `npx vitest run src/app/api/memory/sweep/route.test.ts` → passes

**Context:** Read @src/app/api/mail/scheduled/run/route.ts @src/lib/mail/scheduled.ts @vercel.json @src/lib/agents/memoryStore.ts @src/app/api/chat/history/route.ts @.planning/decisions/ADR-002-durable-memory-architecture.md

---

## Success Criteria
- [ ] Conversations are reduced to durable extracted facts (`memory_facts`), embedded and principal-scoped, that the agent recalls — not raw message substrings. (T1, T3)
- [ ] Recall ranks by salience + recency (hybrid: cosine ⊕ lexical ⊕ recency-decay ⊕ importance), and surfaces a paraphrased fact an `ilike` keyword match would miss. (T3 — AC1, AC2)
- [ ] The dual-path model is preserved: both `autoRecall` and `recall_memory` route through `hybridRecall`; the `recall_memory` tool input/output contract is unchanged and `onedriveTools.test.ts` still passes. (T3 — AC3)
- [ ] Memory is scoped to the session principal: every `memory_facts` query filters on `principal`; cross-principal recall returns nothing (REQ-3). (T1 check constraint + T3 — AC4)
- [ ] Fact extraction is idempotent (upsert on `(session_id, fact)`), runs on session close and via a 5-min cron sweep, with per-session error isolation. (T3 — AC5, T4)
- [ ] `npx tsc --noEmit` exits 0 and `npx vitest run` passes (existing + new suites). (AC7)
- [ ] Migration `0009` enables pgvector and creates `memory_facts` with RLS on, no policies, and a principal check constraint. (T1 — AC6)

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0009_memory_facts.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — pgvector + RLS + principal check (AC6)
**Check type:** command-exit
**Command:** `grep -c "create extension if not exists vector" supabase/migrations/0009_memory_facts.sql; grep -c "enable row level security" supabase/migrations/0009_memory_facts.sql; grep -c "create policy" supabase/migrations/0009_memory_facts.sql; grep -Ec "principal text not null check" supabase/migrations/0009_memory_facts.sql`
**Expected:** `1`, `1`, `0`, `1` (extension on, RLS on, NO policies, principal check present)
**Fail if:** pgvector not enabled, RLS missing, any policy present, or principal check absent

### Contract for Task 1 — embedding dimension locked
**Check type:** grep-match
**Command:** `grep -c "vector(768)" supabase/migrations/0009_memory_facts.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — dimension does not match the adapter's `output_dimensionality: 768`

### Contract for Task 2 — adapter export
**Check type:** grep-match
**Command:** `grep -c "export async function embedText" src/lib/embeddings/index.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the embedding seam does not export `embedText`

### Contract for Task 2 — provider not hardcoded, env block present
**Check type:** grep-match
**Command:** `grep -c "getEmbeddingsEnv" src/lib/env.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — provider config not behind the lazy env seam (ADR-002 §3)

### Contract for Task 2 — correct wire endpoint
**Check type:** grep-match
**Command:** `grep -c ":embedContent" src/lib/embeddings/index.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — adapter does not call Gemini `embedContent`

### Contract for Task 2 — adapter test passes
**Check type:** command-exit
**Command:** `npx vitest run src/lib/embeddings/index.test.ts 2>&1 | grep -cE "passed|✓"`
**Expected:** Non-zero
**Fail if:** Test fails or does not run

### Contract for Task 2 — embedText wired into memoryStore (Rule 6 — wiring)
**Check type:** grep-match
**Command:** `grep -c "from.*@/lib/embeddings" src/lib/agents/memoryStore.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the embedding adapter is created but not imported by its primary consumer

### Contract for Task 3 — both recall paths route through the ranker (AC3, ADR-002 §5)
**Check type:** grep-match
**Command:** `grep -c "hybridRecall" src/lib/agents/memoryTools.ts`
**Expected:** `2` (used in both `recallMemory` and `autoRecall`)
**Fail if:** < 2 — a recall path still uses the old substring matcher

### Contract for Task 3 — substring recall removed
**Check type:** command-exit
**Command:** `grep -c "ilike" src/lib/agents/memoryTools.ts`
**Expected:** `0`
**Fail if:** > 0 — `ilike` substring matching still present in a recall path

### Contract for Task 3 — idempotent upsert (AC5)
**Check type:** grep-match
**Command:** `grep -c "onConflict" src/lib/agents/memoryStore.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — extraction can duplicate facts on re-run

### Contract for Task 3 — principal isolation (AC4 / REQ-3)
**Check type:** grep-match
**Command:** `grep -c 'eq("principal"' src/lib/agents/memoryStore.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — recall queries are not principal-scoped

### Contract for Task 3 — recall_memory tool contract unchanged (AC3)
**Check type:** command-exit
**Command:** `npx vitest run src/lib/agents/onedriveTools.test.ts 2>&1 | grep -cE "passed|✓"`
**Expected:** Non-zero
**Fail if:** The existing tool-dispatcher seam test breaks — the `recall_memory` contract regressed

### Contract for Task 3 — memory store suite passes (AC1, AC2, AC4, AC5)
**Check type:** command-exit
**Command:** `npx vitest run src/lib/agents/memoryStore.test.ts 2>&1 | grep -cE "passed|✓"`
**Expected:** Non-zero
**Fail if:** Paraphrase, ranking, isolation, or idempotency cases fail

### Contract for Task 4 — cron route guarded + wired
**Check type:** grep-match
**Command:** `grep -c "CRON_SECRET" src/app/api/memory/sweep/route.ts; grep -c "extractFacts" src/app/api/memory/sweep/route.ts`
**Expected:** Both non-zero (≥ 1)
**Fail if:** Sweep route is unguarded or does not call the extractor

### Contract for Task 4 — cron registered, mail cron preserved
**Check type:** command-exit
**Command:** `grep -c "/api/memory/sweep" vercel.json; grep -c "/api/mail/scheduled/run" vercel.json`
**Expected:** `1` and `1`
**Fail if:** Sweep cron missing OR existing mail cron removed

### Contract for Task 4 — sweep auth-guard test passes
**Check type:** command-exit
**Command:** `npx vitest run src/app/api/memory/sweep/route.test.ts 2>&1 | grep -cE "passed|✓"`
**Expected:** Non-zero
**Fail if:** Unauthorized request is not rejected, or straggler selection is wrong

### Contract for whole phase — types + suite green (AC7)
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"; npx vitest run 2>&1 | grep -cE "failed"`
**Expected:** `0` and `0`
**Fail if:** Any TypeScript error or any failing test
