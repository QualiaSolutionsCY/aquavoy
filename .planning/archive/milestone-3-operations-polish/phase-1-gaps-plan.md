---
phase: 1
type: gap-closure
goal: "Close the 2 adversarial findings from Phase 1 verification: principal-scope the trace read path (IDOR) and harden the SSE [DONE] splitter against in-content false positives. All 4 success criteria and the 16/16 machine contract already PASS — this is surgical remediation only."
tasks: 2
waves: 1
source_verification: .planning/phase-1-verification.md
---

# Phase 1 Gap Closure — Observability

**Goal:** Eliminate the HIGH IDOR on `GET /api/traces/[id]` and the MEDIUM SSE-splitter false-positive, without touching any passing work.
**Why this phase:** Phase 1 FAILED verification on 2 adversarial findings only. Both have an in-repo precedent or a precise local fix. Closing them unblocks Phase 2.

> Scope discipline: do NOT re-plan T1/T2/T3 from the original plan. The migration, the trace-write path, the UI disclosure row, and all wiring are verified PASS. Touch only the 3 files named below.

## Task 1 — Principal-scope `getTrace` (close HIGH IDOR)
**Wave:** 1
**Persona:** security
**Files:**
- `src/lib/agents/traces.ts` — modify `getTrace`: add a second parameter `principal: string` and add a `.eq("principal", principal)` predicate to the query.
- `src/app/api/traces/[id]/route.ts` — modify the `getTrace(id)` call to `getTrace(id, principal)`, passing the already-verified session principal.
**Depends on:** none

**Why:** `getTrace(id)` (`src/lib/agents/traces.ts:101-112`) queries `.eq("id", id).maybeSingle()` with no principal predicate, so any authenticated principal can read any trace UUID — including the other principal's traces, whose `tool_calls` hold first-200-char previews of email/file/search content (`agent_traces.tool_calls`). The route already derives the verified principal (`src/app/api/traces/[id]/route.ts:19` — `const principal = getPrincipal(req);`) but never passes it down. This mirrors the established `getPendingAction(id, principal)` isolation pattern; `getTrace` is the one read path that broke it.

**Acceptance Criteria:**
- A principal requesting a trace UUID owned by the OTHER principal receives 404 (not the trace) — indistinguishable from a nonexistent id, matching the `getPendingAction` docblock contract.
- A principal requesting their OWN trace UUID still receives `{ ok: true, data: AgentTrace }`.
- `getTrace` no longer compiles when called with a single argument — every call site must supply `principal`.

**Action:**
1. In `src/lib/agents/traces.ts`, change the signature to `export async function getTrace(id: string, principal: string): Promise<AgentTrace | null>`. Add `.eq("principal", principal)` to the query chain immediately after `.eq("id", id)` and before `.maybeSingle()` — the exact two-predicate shape used at `src/lib/agents/pendingActions.ts:131-133`. Update the docblock at line 100 to state the scoping (e.g. "Fetch a single trace by id, scoped to the principal (REQ-3). Returns null when absent OR owned by a different principal — the caller cannot distinguish the two.").
2. In `src/app/api/traces/[id]/route.ts`, change `const trace = await getTrace(id);` (line 25) to `const trace = await getTrace(id, principal);`. The `principal` variable already exists at line 19 and is non-null past the 401 guard at lines 20-22.

**Validation:** (builder self-check)
- `grep -c 'eq("principal", principal)' src/lib/agents/traces.ts` → `1`
- `grep -c 'getTrace(id, principal)' src/app/api/traces/[id]/route.ts` → `1`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/agents/traces.ts, @src/app/api/traces/[id]/route.ts, @src/lib/agents/pendingActions.ts (lines 116-138 — the pattern to mirror)

## Task 2 — Constrain the SSE `[DONE]` splitter to line boundaries (close MEDIUM false-positive)
**Wave:** 1
**Persona:** backend
**Files:**
- `src/lib/openrouter/client.ts` — modify `indexOfBytes` (or its sole call site at line 587) so a `data: [DONE]` match is only accepted at a true SSE line boundary: byte offset 0 of the chunk, OR immediately following a `\n` (0x0A) byte.
**Depends on:** none

**Why:** `indexOfBytes(value, DONE_MARKER)` (`src/lib/openrouter/client.ts:587`, helper at lines 613-624) matches the 12-byte sequence `data: [DONE]` ANYWHERE in a chunk. If a model emits content containing the literal text `data: [DONE]` within a single chunk, the splitter cuts mid-content — forwarding a truncated JSON fragment, then the trace-id line, then garbage bytes — silently dropping that delta from the assistant message. SSE markers are only valid at the start of a line, so the match must be line-boundary-anchored.

**Acceptance Criteria:**
- A chunk whose bytes contain `data: [DONE]` inside a JSON string value (not at a line start) is forwarded untouched — `indexOfBytes`/the splitter returns no match for it, the delta is preserved.
- A real terminal marker — `data: [DONE]` at chunk offset 0, or a `\n` immediately preceding `data: [DONE]` — is still detected, so the trace-id line is still emitted before the marker (the normal happy path at lines 593-605 is unchanged).
- The single-chunk split case and the cross-chunk split case (already verified clean per the Cleared Adversarial Questions) both still terminate via the `if (done)` guard at lines 569-579.

**Action:**
Add a line-boundary constraint to the `[DONE]` search. Read `indexOfBytes` (lines 613-624) and the splitter block (lines 585-605) first. Implement by rejecting any candidate match index `i` unless `i === 0 || haystack[i - 1] === 0x0A` (newline). Concretely: in the `outer` loop of `indexOfBytes`, after a full-needle match is found at index `i`, return `i` only when `i === 0 || haystack[i - 1] === 0x0A`; otherwise `continue outer` to keep scanning. (Equivalent: keep `indexOfBytes` generic and apply the `i === 0 || haystack[i-1] === 0x0A` guard at the call site, looping for the next candidate — but since `indexOfBytes` has exactly one caller, the in-loop guard is the simplest, lowest-surface change.) Update the helper's JSDoc and/or the line-587 comment to state the line-boundary constraint.

**Validation:** (builder self-check)
- `grep -cE '0x0A|0x0a' src/lib/openrouter/client.ts` → `≥1` (the newline-boundary guard exists)
- `grep -c 'haystack\[i - 1\]' src/lib/openrouter/client.ts` → `1` (boundary check on the match index)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/openrouter/client.ts (lines 563-624 — the splitter and `indexOfBytes`)

## Success Criteria
- [ ] `getTrace` requires and applies a `principal` predicate; cross-principal trace reads return 404 (HIGH IDOR closed).
- [ ] The `[DONE]` splitter only fires at a true SSE line boundary; in-content `data: [DONE]` no longer truncates the stream (MEDIUM false-positive closed).
- [ ] `npx tsc --noEmit` exits with 0 errors.
- [ ] No file outside the 3 named above is modified (no re-planning of passing work).

## Verification Contract

### Contract for Task 1 — Principal-scope `getTrace` (predicate)
**Check type:** grep-match
**Command:** `grep -c 'eq("principal", principal)' src/lib/agents/traces.ts`
**Expected:** `1`
**Fail if:** Returns 0 — the principal predicate was not added to the query.

### Contract for Task 1 — Principal-scope `getTrace` (wiring)
**Check type:** grep-match
**Command:** `grep -c 'getTrace(id, principal)' src/app/api/traces/[id]/route.ts`
**Expected:** `1`
**Fail if:** Returns 0 — the route still calls `getTrace(id)` with one arg; verified principal not threaded.

### Contract for Task 1 — signature updated
**Check type:** grep-match
**Command:** `grep -cE 'function getTrace\(\s*id: string,\s*principal: string' src/lib/agents/traces.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the second `principal` parameter is missing from the signature.

### Contract for Task 2 — line-boundary guard exists
**Check type:** grep-match
**Command:** `grep -c 'haystack\[i - 1\] === 0x0A' src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no newline-boundary constraint on the `[DONE]` match index; splitter still matches anywhere.

### Contract for Task 2 — start-of-chunk boundary accepted
**Check type:** grep-match
**Command:** `grep -c 'i === 0' src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — offset-0 (start of chunk) is not accepted as a valid boundary, so the real terminal marker at chunk start would be missed.

### Contract for both tasks — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation errors (e.g. a `getTrace` call site not updated to the 2-arg signature).
