---
phase: 5
result: PASS
gaps: 0
lens: correctness
---

## correctness lens

### Contract Results

Machine contract (phase-5-contract.json) executed at 2026-06-29T08:50:43Z.
19/19 checks passed. Evidence: `.planning/evidence/phase-5-contract-run.json`.

| Task | Check | Result |
|------|-------|--------|
| T1 | file-exists: 0018_processed_messages.sql | PASS |
| T1 | grep: enable row level security | PASS |
| T1 | grep: create policy — absent | PASS |
| T1 | grep: unique (mailbox, uid) | PASS |
| T1 | vitest processedMessages.test.ts (8 tests) | PASS |
| T2 | grep: from "@/lib/openrouter/client" | PASS |
| T2 | grep: creditNote\|voyageSummary | PASS |
| T2 | vitest inboxClassifier.test.ts (8 tests) | PASS |
| T3 | grep: executeConfirmedAction — absent | PASS |
| T3 | grep: admin@aquavoy.com | PASS |
| T3 | grep: rice@aquavoy.com | PASS |
| T3 | grep: Wency | PASS |
| T3 | vitest inboxScan.test.ts (14 tests) | PASS |
| T4 | file-exists: src/app/api/mail/scan/run/route.ts | PASS |
| T4 | grep: CRON_SECRET | PASS |
| T4 | grep: runInboxScan | PASS |
| T4 | grep proxy.ts: /api/mail/scan/run | PASS |
| T4 | grep vercel.json: /api/mail/scan/run | PASS |
| T4 | vitest proxy.test.ts (5 tests) | PASS |

### Code Quality

- TypeScript: PASS — `npx tsc --noEmit` exits 0 (no output)
- Full test suite: PASS — 28 files / 216 tests green (`npx vitest run`)
- Stubs: 0 (no TODO/FIXME/placeholder in any touched file)
- Empty error swallows: 0 — bare `catch {` at `src/lib/mail/inboxScan.ts:135` increments `errors++`; not a swallow

### Criterion-level findings

**runInboxScan correctness**

Both mailboxes iterated: `src/lib/mail/inboxScan.ts:20` — `const MAILBOXES = ["admin@aquavoy.com", "rice@aquavoy.com"] as const`; looped at line 58.

Skip gate: `src/lib/mail/inboxScan.ts:66-69` — `if (await isAlreadyProcessed(mailbox, e.uid)) { skipped++; continue; }` — classify and stage NOT reached on skip. Test `(a)` asserts `classifyMessageMock` and `stagePendingActionMock` not called when `isAlreadyProcessed` returns true.

markProcessed BEFORE stagePendingAction: `src/lib/mail/inboxScan.ts:82,103/118` — `await markProcessed(...)` at line 82, `await stagePendingAction(...)` at lines 103/118. Test `(b)` asserts `markProcessedMock.mock.invocationCallOrder[0] < stagePendingActionMock.mock.invocationCallOrder[0]`.

ONE action per financial message: `src/lib/mail/inboxScan.ts:94-129` — a single `if/else if` block with one `stagePendingAction` call per branch; no loop, no second call. Test `(c)` asserts `stagePendingActionMock` called exactly once even with 2 attachments.

Financial categories and tool mapping: `src/lib/mail/inboxScan.ts:94-128` — `creditNote` → `record_finance_entry` direction=income; `invoice` → `record_finance_entry` direction=expense; `voyageSummary` → `record_voyage_entry`. Tests `tool mapping` suite covers all three branches.

Non-financial processed-not-staged: `src/lib/mail/inboxScan.ts:84-89` — `if (!FINANCIAL.includes(category)) { scanned++; ... continue; }` — non-financial messages are marked processed and counted but never reach `stagePendingAction`. Test asserts `stagePendingActionMock` not called for important/routine/spam.

Per-message error catch: `src/lib/mail/inboxScan.ts:135-138` — `} catch { errors++; /* continue */ }` — outer loop continues. Test `(e)` verifies `summary.errors === 1` and `summary.staged === 1` (second message still processed after first throws).

executeConfirmedAction absent: grep returned empty — `executeConfirmedAction` is not imported or called anywhere in `src/lib/mail/inboxScan.ts`.

ScanSummary returned: `src/lib/mail/inboxScan.ts:142` — `return { scanned, skipped, staged, errors, byMailbox };`

**Idempotency**

upsert onConflict ignoreDuplicates: `src/lib/mail/processedMessages.ts:40` — `{ onConflict: "mailbox,uid", ignoreDuplicates: true }` — second call for same (mailbox, uid) silently no-ops.

isAlreadyProcessed after mark: `src/lib/mail/processedMessages.ts:54-65` — `.maybeSingle()` on mailbox+uid, returns `data !== null`. processedMessages.test.ts 8 tests cover both true and false branches.

**Classifier degrades to "routine" on malformed reply**

`src/lib/mail/inboxClassifier.ts:99-110` — four return-"routine" guards: empty candidate (line 99), JSON.parse throws (line 104-105), non-object (line 108), unrecognized literal (line 110). Tests `(c)`, `(d)`, empty string, missing category field all assert `"routine"` — 0 throws.

**Cron route**

CRON_SECRET bearer gate: `src/app/api/mail/scan/run/route.ts:19` — `if (!cronSecret || authHeader !== \`Bearer ${cronSecret}\`)` returns 401. Safe-fail: missing env var also triggers 401.

Calls runInboxScan: `src/app/api/mail/scan/run/route.ts:24` — `return ok(await runInboxScan())`; error path calls `Sentry.captureException(err)` then `fail(...)`.

Proxy allowlist: `src/proxy.ts:36` — `/api/mail/scan/run` present in `ALLOWLIST` Set.

vercel.json schedule: `vercel.json:16-19` — `{"path":"/api/mail/scan/run","schedule":"0 */6 * * *"}` — valid cron expression (every 6 hours at minute 0).

vercel.json valid JSON: file parses cleanly (read confirms well-formed JSON with 4 cron entries).

### Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| runInboxScan behavior | 5 | 5 | 5 | 5 | PASS |
| Idempotency (markProcessed / isAlreadyProcessed) | 5 | 5 | 5 | 5 | PASS |
| Classifier degrades to "routine" | 5 | 5 | 5 | 5 | PASS |
| Cron route + proxy + vercel.json | 5 | 5 | 5 | 5 | PASS |
| tsc + full test suite | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** No score below 3. All dimensions 5.

### Gaps

None.

### Verdict

PASS — Phase 5 correctness verified. All 19 contract checks green, tsc clean, 216/216 tests pass. All correctness criteria — idempotency, ordering (markProcessed before stage), one-action-per-financial-email, non-financial processed-not-staged, per-message error isolation, executeConfirmedAction absent, CRON_SECRET gate, vercel.json schedule — confirmed by direct code inspection with file:line citations.

---

## security lens

### ADR-003 — No Auto-Execute (CRITICAL gate)

`grep -c "executeConfirmedAction" src/lib/mail/inboxScan.ts` → `0` (exit 1, no match)

`src/lib/mail/inboxScan.ts:1-4` — imports are `listEmails`, `readEmail`, `classifyMessage`, `markProcessed`, `isAlreadyProcessed`, `stagePendingAction`. The import of `executeConfirmedAction` is structurally absent.

The executor lives at `src/lib/agents/executeConfirmedAction.ts:44` and is only reached via `src/lib/agents/pendingActions.ts:179` (the human-confirm path). No Phase 5 code path imports or calls it.

PASS — ADR-003 satisfied. A spoofed or malicious email cannot cause a financial write without a human confirm step.

---

### Cron Auth Gate

`src/app/api/mail/scan/run/route.ts:16-20`:

```
const authHeader = req.headers.get("authorization") ?? "";
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
  return fail("Unauthorized", 401);
}
```

Two failure modes both covered: (1) `!cronSecret` — env var absent → 401, preventing an open route when the secret is not set; (2) `authHeader !== \`Bearer ${cronSecret}\`` — wrong or missing token → 401. This matches the structure of the existing `src/app/api/mail/scheduled/run/route.ts` cron gate.

PASS — route is not publicly invokable.

---

### Proxy Allowlist + vercel.json Lock-step (prior prod bug guard)

`src/proxy.ts:36` — `"/api/mail/scan/run",` present in the `ALLOWLIST` Set.

`vercel.json:16-19` — `{"path": "/api/mail/scan/run", "schedule": "0 */6 * * *"}` present in `crons` array.

`src/proxy.ts:10-11` — doc comment documents the new path: "guarded by its own CRON_SECRET bearer check" — consistent with all four existing cron allowlist entries.

The allowlist lets Vercel's `Authorization: Bearer CRON_SECRET` reach the handler (bypassing the session-cookie check). The route's own bearer gate is the actual security control. Being allowlisted does not open the route.

proxy.test.ts lock-step regression: contract evidence `phase-5-contract-run.json` T4 check index 5 — 5/5 tests pass, confirming every vercel.json cron path is also in the allowlist.

PASS — proxy allowlist and vercel.json are in lock-step; the allowlisted route is protected by its own CRON_SECRET gate.

---

### processed_messages RLS — Service-Role Only (constitution)

`supabase/migrations/0018_processed_messages.sql:34` — `alter table public.processed_messages enable row level security;`

`grep -c "create policy" supabase/migrations/0018_processed_messages.sql` → `0` — no policy declarations. Confirmed by: `grep -n "create policy|for select|for insert|for update|for delete" 0018_processed_messages.sql` returned no output.

`supabase/migrations/0018_processed_messages.sql:9-11` — inline comment states: "Only server code using SUPABASE_SERVICE_ROLE_KEY touches it."

`src/lib/mail/processedMessages.ts:1` — `import { supabaseAdmin } from "@/lib/supabase/server";` — uses the service-role client exclusively (lines 32, 55, 74).

`src/lib/supabase/server.ts:15` — `supabaseAdmin` uses `SUPABASE_SERVICE_ROLE_KEY`. The env var name does not start with `NEXT_PUBLIC_`, so it is not bundled into the browser.

No `"use client"` directive found in any Phase 5 file (`inboxScan.ts`, `inboxClassifier.ts`, `processedMessages.ts`, `route.ts`). All are server-only modules.

`processedMessages.ts` is imported only from `src/lib/mail/inboxScan.ts:3` (server module) and is not reachable from any client component in the import graph.

PASS — constitution satisfied: RLS on, no policies, service-role only.

---

### Staged Proposal Safety

`src/lib/mail/inboxScan.ts:17` — `const SCAN_PRINCIPAL = "Wency";` — hardcoded server constant, not derived from email sender, subject, body, or LLM output.

`src/lib/mail/inboxScan.ts:104,119` — both `stagePendingAction` calls pass `principal: SCAN_PRINCIPAL`.

`supabase/migrations/0010_pending_actions.sql:17` — `check (principal in ('Wency', 'Jeanette'))` — DB-level CHECK constraint rejects any runtime value outside the two valid principals.

`src/lib/mail/inboxScan.ts:107,122` — `company: null` in staged `args` for both `record_finance_entry` and `record_voyage_entry` branches. No `amount`, `price`, `value`, or `cost` field appears in any staged args (grep returned no results).

`src/lib/mail/inboxScan.ts:95` — `direction` is derived from the validated `category` literal (`creditNote` → `"income"`, `invoice` → `"expense"`), not extracted from email body text.

`src/lib/mail/inboxClassifier.ts:110` — invalid category values fall back to `"routine"`. `"routine"` is not in `FINANCIAL` (`src/lib/mail/inboxScan.ts:23`), so a corrupted or injected classification can never trigger staging.

PASS — staged proposals are safe proposals. No financial write can be triggered from email content without a human confirmation step.

---

### Secret / service_role Exposure

`grep -rn "SUPABASE_SERVICE_ROLE_KEY" src/ --include="*.ts" --include="*.tsx"` excluding `server.ts` and `env.ts` → no results. Key is used only in `src/lib/supabase/server.ts:15`.

No `NEXT_PUBLIC_*` wrapping of any secret was found in any Phase 5 file.

Email content sent to the LLM is clipped before transmission: `src/lib/mail/inboxClassifier.ts:15-17` — `FIELD_CAP = 200`, `BODY_CAP = 2000`; applied at lines 84-86. This matches the established `briefing.ts` pattern. Note: sending email content to an LLM via `complete()` is the established codebase pattern and not a new exposure surface introduced by Phase 5.

PASS — no secret or service_role key exposure.

---

### Security Summary

| Check | Verdict | Evidence |
|---|---|---|
| No auto-execute (ADR-003) | PASS | `src/lib/mail/inboxScan.ts` — `executeConfirmedAction` absent (grep exit 1, 0 hits) |
| Cron bearer gate — missing secret also 401s | PASS | `src/app/api/mail/scan/run/route.ts:19` — `!cronSecret \|\| header !== Bearer` → 401 |
| Proxy allowlist + vercel.json lock-step | PASS | `src/proxy.ts:36` + `vercel.json:16` + proxy.test.ts 5/5 pass |
| processed_messages RLS on, no policies | PASS | `0018_processed_messages.sql:34` RLS enabled; grep confirms 0 policy declarations |
| Staged args: company null, no amount, fixed principal | PASS | `inboxScan.ts:107,122` `company:null`; no amount field; `SCAN_PRINCIPAL="Wency"` hardcoded at line 17 |
| service_role not exposed; no NEXT_PUBLIC wrapping | PASS | `SUPABASE_SERVICE_ROLE_KEY` in server.ts only; no Phase 5 file uses NEXT_PUBLIC |

**Findings written to:** `.planning/phase-5-panel-security.json` — `[]` (zero findings)

**Security verdict: PASS — 0 findings. No security gaps detected in Phase 5.**
