---
phase: 1
result: PASS
gaps: 0
---

# Phase 1 Verification — Durable Memory (Re-verification after security fix)

**Goal:** Recall is reliable across long histories, not just keyword-grep over recent messages.

Design Verification: N/A (no frontend tasks in phase)

---

## Re-verification Context

Prior report (same file) returned FAIL on ONE finding (HIGH): the `recall_memory` tool executor read `principal` from the model's tool-call args rather than the HMAC-verified session identity, enabling a cross-principal read (Wency reading Jeanette's memory). A fix was applied. This report independently confirms the exploit is closed and all 7 ACs hold.

---

## Contract Results

Machine contract re-ran: **24 checks, 0 failures** (`evidence/phase-1-contract-run.json`).

| Task | Check | Result | Evidence |
|------|-------|--------|---------|
| T1 | file-exists: `0009_memory_facts.sql` | PASS | file exists, substantive |
| T1 | grep: `create extension if not exists vector` | PASS | `supabase/migrations/0009_memory_facts.sql:13` |
| T1 | grep: `enable row level security` | PASS | `supabase/migrations/0009_memory_facts.sql:41` |
| T1 | grep: `create policy` absent | PASS | count=0 |
| T1 | grep: `vector(768)` | PASS | confirmed |
| T2 | tsc --noEmit | PASS | exit 0, no output |
| T2 | grep: `export async function embedText` | PASS | `src/lib/embeddings/index.ts:25` |
| T2 | grep: `getEmbeddingsEnv` in env.ts | PASS | count=1 |
| T2 | grep: `:embedContent` | PASS | `src/lib/embeddings/index.ts:27` |
| T2 | vitest embeddings test | PASS | passed |
| T2 | embeddings wired into memoryStore | PASS | `src/lib/agents/memoryStore.ts:2` |
| T3 | tsc --noEmit | PASS | exit 0 |
| T3 | hybridRecall in memoryTools | PASS | count=2 |
| T3 | ilike absent | PASS | count=0 |
| T3 | onConflict in memoryStore | PASS | `src/lib/agents/memoryStore.ts:267` |
| T3 | `.eq("principal"` in memoryStore | PASS | `src/lib/agents/memoryStore.ts:159` |
| T3 | onedriveTools.test.ts passes | PASS | passed |
| T3 | memoryStore.test.ts passes | PASS | passed |
| T4 | tsc --noEmit | PASS | exit 0 |
| T4 | `CRON_SECRET` in sweep route | PASS | `src/app/api/memory/sweep/route.ts:33` |
| T4 | `extractFacts` in sweep route | PASS | `src/app/api/memory/sweep/route.ts:4,95` |
| T4 | `/api/memory/sweep` in vercel.json | PASS | `vercel.json:8` |
| T4 | `/api/mail/scheduled/run` in vercel.json | PASS | `vercel.json:4` |
| T4 | sweep route test passes | PASS | passed |

Full suite: **43/43 tests passed** (up from 41 — 2 new regression tests in `onedriveTools.test.ts` now confirmed in scope), exit 0.

---

## Security Fix Verification — AC4 (Finding 1 from prior report)

### Claim 1: `executeTool` now accepts a `sessionPrincipal` parameter

`src/lib/agents/onedriveTools.ts:567-572`:
```
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  connectionId?: string | null,
  sessionPrincipal?: string | null,
): Promise<string>
```
CONFIRMED. Fourth parameter `sessionPrincipal?: string | null` added.

### Claim 2: `recall_memory` case pins to `sessionPrincipal`, NEVER reads `args.principal`

`src/lib/agents/onedriveTools.ts:663-673`:
```
case "recall_memory": {
  const query = typeof args.query === "string" ? args.query : "";
  // Principal is pinned to the HMAC-verified session identity passed in by
  // the caller — NEVER args.principal. The model cannot read another
  // operator's memory by naming them in the tool call (REQ-3 / ADR-001).
  // Fail closed if there is no verified session principal.
  if (!sessionPrincipal)
    return JSON.stringify({ error: "no verified principal in session" });
  if (!query) return JSON.stringify({ error: "query is required" });
  return await recallMemory(query, sessionPrincipal);
}
```
CONFIRMED. `args.principal` is never read in the case body. `sessionPrincipal` is the only identity source. Fails closed (returns error JSON, does NOT call `recallMemory`) when `sessionPrincipal` is absent/null/undefined.

### Claim 3: `args.principal` no longer read as live code anywhere

Grep result: `grep -rn "args\.principal" src/ --include="*.ts"` returns:
- `src/lib/agents/onedriveTools.ts:666` — inside a comment string: `// the caller — NEVER args.principal`
- `src/lib/agents/onedriveTools.test.ts:121` — inside a test description string: `"pins recall to the verified session principal, ignoring args.principal"`

Neither is executable code. No live read of `args.principal` exists anywhere in source.

### Claim 4: `client.ts` forwards `opts.identity` as the fourth `executeTool` arg

`src/lib/openrouter/client.ts:334-337`:
```
// Identity for principal-scoped tools (e.g. recall_memory) is taken from
// the HMAC-verified session, NEVER from the model's tool-call arguments —
// otherwise the model could be steered to read another principal's data.
const result = await executeTool(tc.function.name, args, null, opts.identity);
```
CONFIRMED. `opts.identity` (the `Principal` type sourced from the verified session) is forwarded as the fourth argument.

### Claim 5: `opts.identity` originates from `getPrincipal(req)` in the chat route; route rejects when absent

`src/app/api/chat/route.ts:19-22`:
```
const identity = getPrincipal(req) ?? undefined;
if (!identity) {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
```
CONFIRMED. Identity is derived from the verified session cookie. Requests without identity are rejected with HTTP 401 before any tool execution.

`src/app/api/chat/route.ts:51`:
```
const upstream = await streamChatWithTools(messages, { identity });
```
CONFIRMED. `identity` flows through to `streamChatWithTools` as `opts.identity`, which is then forwarded to `executeTool`.

### Claim 6: Tool DEFINITION no longer exposes a `principal` parameter

`src/lib/agents/onedriveTools.ts:226-244` — the `recall_memory` tool definition:
```
{
  type: "function" as const,
  function: {
    name: "recall_memory",
    description:
      "Search through past conversation history to recall what was discussed before. Use this when the user references previous conversations or asks what was talked about earlier. Memory is automatically scoped to the current operator — you do not specify whose history to search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term to find in past messages.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
},
```
CONFIRMED. `properties` contains only `query`. No `principal` parameter is exposed in the JSON schema. The model cannot supply a `principal` field — and even if it tried (via `additionalProperties: false` violation or forced injection), the executor ignores it.

### Claim 7: Regression tests prove pinning and fail-closed behaviour

`src/lib/agents/onedriveTools.test.ts:118-136`:

Test A (line 121-128) — `"pins recall to the verified session principal, ignoring args.principal"`:
```
await executeTool("recall_memory", { query: "pricing", principal: "Jeanette" }, null, "Wency");
expect(recallMemoryMock).toHaveBeenCalledWith("pricing", "Wency");
expect(recallMemoryMock).not.toHaveBeenCalledWith("pricing", "Jeanette");
```
CONFIRMED present. Test passes (43/43).

Test B (line 130-135) — `"fails closed when there is no verified session principal"`:
```
const out = await executeTool("recall_memory", { query: "pricing", principal: "Jeanette" }, null, undefined);
const parsed = JSON.parse(out);
expect(parsed.error).toBe("no verified principal in session");
expect(recallMemoryMock).not.toHaveBeenCalled();
```
CONFIRMED present. Test passes (43/43).

### Exploit Chain — CLOSED

Prior exploit: Wency authenticated → model emits `recall_memory({ query: "pricing", principal: "Jeanette" })` → executor reads `args.principal = "Jeanette"` → `recallMemory("pricing", "Jeanette")` → Jeanette's facts returned to Wency.

Post-fix path: Wency authenticated → `identity = "Wency"` from `getPrincipal(req)` → `streamChatWithTools(messages, { identity: "Wency" })` → `executeTool(name, args, null, "Wency")` → `recall_memory` case: `sessionPrincipal = "Wency"`, `args.principal` ignored → `recallMemory("pricing", "Wency")` → only Wency's facts returned.

No-session path: `sessionPrincipal` is `undefined` → `if (!sessionPrincipal)` fires → returns `{ error: "no verified principal in session" }` → `recallMemory` never called.

**AC4 exploit: CLOSED.**

---

## 3-Level Check — All 7 Acceptance Criteria

### AC1 — Paraphrase Recall

**Level 2 (Artifacts):**
- `src/lib/agents/memoryStore.ts:70-82` — `cosine(a, b)` full dot-product implementation, not a stub.
- `src/lib/agents/memoryStore.ts:101-102` — `const sim = cosine(opts.queryEmbedding, c.embedding)` called in `rankFacts`.
- `src/lib/agents/memoryStore.test.ts:83-109` — paraphrase test with near-vector stub, no shared ≥5-char word, asserts correct ranking.

**Level 3 (Wiring):** `rankFacts` called from `hybridRecall` at `src/lib/agents/memoryStore.ts:175`; `hybridRecall` imported and called from `memoryTools.ts`. Tests pass.

**Verdict: PASS**

---

### AC2 — Deterministic Ranking

**Level 2 (Artifacts):**
- `src/lib/agents/memoryStore.ts:50` — `const DEFAULT_WEIGHTS = { sim: 0.5, lex: 0.2, rec: 0.2, imp: 0.1 }`
- `src/lib/agents/memoryStore.ts:86` — deterministic score formula documented.
- `src/lib/agents/memoryStore.ts:97,104-110` — `opts.nowMs` injectable; `created_at` tiebreak.
- `src/lib/agents/memoryStore.test.ts:45-79` — AC2 test: fixed inputs → identical order on two runs.

**Level 3 (Wiring):** Pure function. Called by `hybridRecall`. Test passes.

**Verdict: PASS**

---

### AC3 — No Regression on Dual-Path Contract

**Level 2 (Artifacts):**
- `src/lib/agents/memoryTools.ts:28-54` — `recallMemory(query: string, principal: string): Promise<string>` — signature unchanged. Returns `{ hits }` | `{ message, hits: [] }` | `{ error }` — shape unchanged.
- `src/lib/agents/memoryTools.ts:64-86` — `autoRecall(principal: string, userText: string): Promise<string | null>` — unchanged.
- ilike absent: count=0.

**Level 3 (Wiring):** `recall_memory` executor at `src/lib/agents/onedriveTools.ts:672` calls `return await recallMemory(query, sessionPrincipal)`. `autoRecall` imported at `src/app/api/chat/route.ts:3`, called at line 46. `onedriveTools.test.ts`: all tests pass including the new security tests.

The shape of `executeTool`'s call to `recallMemory` changed (principal arg now comes from `sessionPrincipal` not `args.principal`) but the `recallMemory` function signature and return contract are identical. The existing `onedriveTools.test.ts` mock (`vi.mock("@/lib/agents/memoryTools", () => ({ recallMemory: vi.fn() }))`) still works because it mocks at the module boundary — the change is internal to the `recall_memory` case only.

**Verdict: PASS**

---

### AC4 — Principal Isolation (REQ-3)

**Level 2 (Artifacts):**
- `src/lib/agents/memoryStore.ts:159` — `.eq("principal", principal)` in `hybridRecall`. CONFIRMED.
- `supabase/migrations/0009_memory_facts.sql:17` — `principal text not null check (principal in ('Wency', 'Jeanette'))`. CONFIRMED.
- `src/lib/agents/memoryStore.test.ts:111-121` — isolation test: asserts `.eq("principal","Wency")` is issued.

**Level 3 (Wiring) — PASS (previously FAIL):**
- `src/lib/agents/onedriveTools.ts:669-672` — `sessionPrincipal` gates the call; `recallMemory` receives `sessionPrincipal`, never `args.principal`.
- `src/lib/openrouter/client.ts:337` — `executeTool(tc.function.name, args, null, opts.identity)` forwards the session identity.
- `src/app/api/chat/route.ts:19-22` — `identity` derived from `getPrincipal(req)` (HMAC-verified); request rejected 401 when absent.
- Regression test at `onedriveTools.test.ts:121-128` proves `recallMemory` is called with `"Wency"` even when `args.principal = "Jeanette"`.
- Fail-closed test at `onedriveTools.test.ts:130-135` proves `recallMemory` is NOT called when `sessionPrincipal` is absent.
- 43/43 tests pass including both new security tests.

**Severity: RESOLVED** — the HIGH finding from the prior report is closed.

**Verdict: PASS**

---

### AC5 — Idempotent Fact Extraction

**Level 2 (Artifacts):**
- `supabase/migrations/0009_memory_facts.sql:25-26` — unique constraint `memory_facts_session_fact_uniq (session_id, fact)`. CONFIRMED.
- `src/lib/agents/memoryStore.ts:265-267` — `.upsert(rows, { onConflict: "session_id,fact", ignoreDuplicates: false })`. CONFIRMED.
- `src/lib/agents/memoryStore.test.ts:124-165` — idempotency test: two runs, both assert `{ onConflict: "session_id,fact" }`.

**Verdict: PASS**

---

### AC6 — Migration 0009 Schema/Security

All elements confirmed:
- `supabase/migrations/0009_memory_facts.sql:13` — `create extension if not exists vector;`
- `supabase/migrations/0009_memory_facts.sql:17` — principal check constraint
- `supabase/migrations/0009_memory_facts.sql:21` — `embedding vector(768)`
- `supabase/migrations/0009_memory_facts.sql:25-26` — unique constraint
- `supabase/migrations/0009_memory_facts.sql:33-38` — both indexes
- `supabase/migrations/0009_memory_facts.sql:41` — `enable row level security`
- `create policy` count: 0
- Numbering after `0008`: confirmed

**Verdict: PASS**

---

### AC7 — TypeScript + Test Suite Green

- `npx tsc --noEmit`: exit 0, no output. CONFIRMED.
- `npx vitest run`: **43 tests, 11 test files, all passed**. CONFIRMED.
  - 2 additional tests vs prior run: `"pins recall to the verified session principal, ignoring args.principal"` and `"fails closed when there is no verified session principal"` both pass.

**Verdict: PASS**

---

## Code Quality

- TypeScript: PASS (exit 0, clean, no `error TS` output)
- Stubs (TODO/FIXME/placeholder/not implemented): 0 in touched files
- Empty catch blocks: `memoryTools.ts:73` — `catch { return null; }` — graceful degradation (intentional); `memoryStore.ts:232` — `catch { }` in `parseEmbedding` string fallback — benign
- Unused imports: 0
- Security gap (Finding 1 from prior report): CLOSED — `args.principal` removed from live execution path; `sessionPrincipal` pins all `recall_memory` calls to HMAC-verified identity; fail-closed when session absent

---

## Standing Findings (non-blocking, deferred)

These were raised in the prior report and have not changed. They do not affect the PASS verdict.

| # | Severity | File:line | Description |
|---|----------|-----------|-------------|
| 2 | MEDIUM | `src/app/api/memory/sweep/route.ts:35` | Plain `!==` for `CRON_SECRET`; inconsistent with `session.ts:34` `timingSafeEqual` |
| 3 | MEDIUM | `supabase/migrations/0009_memory_facts.sql:21` + `memoryStore.ts:130-141` | Nullable `embedding`; NULL rows score cosine=0 and pollute rankings |
| 4 | LOW | `src/lib/agents/memoryStore.ts:248` | Case-variant fact text can bypass `memory_facts_session_fact_uniq` |
| 5 | LOW | `src/app/api/memory/sweep/route.ts:42-45` | Unbounded `chat_messages` scan on every cron invocation |

---

## Deferred Item (documented, not a FAIL)

**Live smoke:** Real migration apply to Supabase, real Gemini embedding call, end-to-end recall with live DB — deferred to ship/with-env per `phase-1-context.md`. Code correctness, wiring, mocked-seam tests, and security fix all fully verified. Live smoke flagged for next environment-gated session.

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| AC1 — Paraphrase recall | 5 | 5 | 5 | 5 | PASS |
| AC2 — Deterministic ranking | 5 | 5 | 5 | 5 | PASS |
| AC3 — Dual-path no regression | 5 | 5 | 5 | 5 | PASS |
| AC4 — Principal isolation | 5 | 5 | **5** | 5 | PASS |
| AC5 — Idempotent extraction | 5 | 5 | 5 | 4 | PASS |
| AC6 — Migration schema/security | 5 | 5 | 5 | 4 | PASS |
| AC7 — tsc 0 + vitest green | 5 | 5 | 5 | 5 | PASS |

**AC4 Wiring score rationale (revised from 1 → 5):** `hybridRecall` emits the correct `.eq("principal")` filter (Correctness=5) and is called from both recall paths (Completeness=5). The `recall_memory` executor now pins `principal` to `sessionPrincipal` — the HMAC-verified value forwarded from `opts.identity` in `streamChatWithTools` → `getPrincipal(req)` in the chat route. `args.principal` is never read in live code. Fail-closed when `sessionPrincipal` is absent. Two regression tests independently prove both properties. The isolation guarantee is fully end-to-end: DB filter, executor pinning, and session-gate all confirmed. Wiring=5.

**Minimum threshold check:** All criteria score ≥ 3 on all dimensions. NO scores below 3. PASS.

---

## Verdict

PASS — Phase 1 goal achieved. The HIGH security finding (cross-principal memory read via model-controlled `args.principal`) is CLOSED. All 7 ACs score ≥ 3 on all dimensions. TypeScript exits 0. Full test suite passes (43/43, including 2 new regression tests that independently verify the fix). Contract runner: 24/24. Proceed to Phase 2.
