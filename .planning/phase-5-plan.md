---
phase: 5
goal: "A cron checks the admin@/rice@ inboxes ~4×/day, classifies new mail (invoice/credit-note/voyage-summary) via the LLM, is idempotent, and STAGES save-attachment/record-finance/generate-invoice/record-voyage proposals into the existing confirm/undo action-stack — never auto-executing a financial write."
tasks: 4
waves: 3
---

# Phase 5: Automated inbox scanning

**Goal:** A cron checks the `admin@aquavoy.com` (credit notes) and `rice@aquavoy.com` (voyage details) inboxes ~4×/day, classifies each new message with the LLM, records it as processed BEFORE staging (idempotent), and stages ONE proposal per financial message into the existing `pending_actions` confirm/undo stack — never auto-executing.

**Why this phase:** This is the "checks email 4×/day and presents what's ready" behavior — the autonomous front-end of the M6 invoice/voyage pipeline that P2–P4 already built the confirm-and-execute back-end for. It ships independently: P5 produces only cron + classification + STAGING; execution of those staged actions is the already-shipped confirm path.

**Implements:** REQ-29.

---

## Task 1 — Idempotency table + processedMessages store
**Wave:** 1
**Persona:** backend
**Files:**
- CREATE `supabase/migrations/0018_processed_messages.sql` — `public.processed_messages` table, RLS on, no policies.
- CREATE `src/lib/mail/processedMessages.ts` — exports `markProcessed`, `isAlreadyProcessed`, `cleanupProcessed`.
- CREATE `src/lib/mail/processedMessages.test.ts` — unit tests with `supabaseAdmin` mocked.
**Depends on:** none

**Why:** REQ-29 requires the scan to be idempotent — a retried or overlapping cron must never re-stage the same email twice. The idempotency key is `(mailbox, uid)` plus `message_id` (scope-m6 Phase 5 decision: "idempotency on UID + Message-ID, no body hash"). `markProcessed` must commit BEFORE staging (relevant-learnings), so a crash between mark and stage skips the message rather than double-staging it.

**Acceptance Criteria:**
- Migration `0018_processed_messages.sql` creates `processed_messages(id, mailbox, uid, message_id, category, processed_at)` with a UNIQUE constraint on `(mailbox, uid)`, RLS enabled, no policies (matches 0017's "RLS on, no policies" pattern at `supabase/migrations/0017_voyage_entries.sql:84`).
- `isAlreadyProcessed(mailbox, uid)` returns `true` for a previously-marked `(mailbox, uid)` and `false` otherwise.
- `markProcessed` is safe to call twice for the same `(mailbox, uid)` — the second call does NOT throw (use `upsert`/`onConflict: "mailbox,uid"`, mirroring the conflict handling already used in the codebase at `supabase/migrations/0005_fix_mail_accounts_on_conflict.sql`).

**Action:**
1. Write `0018_processed_messages.sql`. Columns: `id uuid primary key default gen_random_uuid()`, `mailbox text not null`, `uid integer not null`, `message_id text`, `category text not null`, `processed_at timestamptz not null default now()`. Add `constraint processed_messages_mailbox_uid_unique unique (mailbox, uid)`. Add `create index processed_messages_processed_at_idx on public.processed_messages (processed_at)` to support `cleanupProcessed`. End with `alter table public.processed_messages enable row level security;` and a `comment on table` line stating "Inbox-scan idempotency ledger (REQ-29). Service-role only (RLS on, no policies)."
2. Write `processedMessages.ts`. Import `supabaseAdmin` from `@/lib/supabase/server` (same import line as `src/lib/mail/scheduled.ts:1`). `const TABLE = "processed_messages";`.
   - `markProcessed(input: { mailbox: string; uid: number; messageId: string | null; category: string }): Promise<void>` — `db.from(TABLE).upsert({ mailbox, uid, message_id, category }, { onConflict: "mailbox,uid", ignoreDuplicates: true })`; throw `new Error(\`Failed to mark processed: ${error.message}\`)` on error.
   - `isAlreadyProcessed(mailbox: string, uid: number): Promise<boolean>` — `db.from(TABLE).select("id").eq("mailbox", mailbox).eq("uid", uid).maybeSingle()`; return `data !== null`.
   - `cleanupProcessed(olderThanDays = 90): Promise<number>` — delete rows with `processed_at < now - olderThanDays`; return count deleted.
3. Write `processedMessages.test.ts` with `vitest`. Mock `@/lib/supabase/server` (`vi.mock`) so `supabaseAdmin()` returns a chainable stub. Assert: (a) `isAlreadyProcessed` returns true when the stub yields a row and false when it yields null; (b) `markProcessed` calls `.upsert` with `onConflict: "mailbox,uid"`; (c) `markProcessed` does not throw on a duplicate (stub returns no error).

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "processedMessages"` → `0`
- `npx vitest run src/lib/mail/processedMessages.test.ts` → all pass
- `grep -c "enable row level security" supabase/migrations/0018_processed_messages.sql` → `1`
- `grep -c "create policy\|for select\|for insert" supabase/migrations/0018_processed_messages.sql` → `0` (no policies — service-role only)

**Context:** Read @supabase/migrations/0017_voyage_entries.sql @src/lib/mail/scheduled.ts @.planning/scope-m6.md

---

## Task 2 — Inbox classifier (separate from briefing.ts)
**Wave:** 1
**Persona:** backend
**Files:**
- CREATE `src/lib/mail/inboxClassifier.ts` — exports `classifyMessage` + `InboxCategory` type.
- CREATE `src/lib/mail/inboxClassifier.test.ts` — unit tests with `complete()` mocked.
**Depends on:** none

**Why:** REQ-29 needs each new message classified as `invoice` / `creditNote` / `voyageSummary` / `important` / `routine` / `spam`. scope-m6 Phase 5 locks this as a SEPARATE module from `briefing.ts` (a different task: per-message single-label classification, not whole-inbox triage) running on the existing OpenRouter `complete()` — no new SDK. Only the three financial categories drive staging in Task 3.

**Acceptance Criteria:**
- `classifyMessage({ from, subject, body })` returns one of the six `InboxCategory` literals.
- A credit-note-shaped email (subject/body mentioning a credit note / Gefo reference) classifies as `creditNote`; a voyage-details email classifies as `voyageSummary`; a supplier invoice as `invoice`.
- A malformed model reply degrades to `routine` (the safe non-financial default) rather than throwing — mirroring `briefing.ts`'s defensive parse (`src/lib/mail/briefing.ts:93-132`).

**Action:**
1. Write `inboxClassifier.ts`. Import `{ complete, type ChatMessage, type ChatOptions }` from `@/lib/openrouter/client` (same import as `src/lib/mail/briefing.ts:2`).
   - `export type InboxCategory = "invoice" | "creditNote" | "voyageSummary" | "important" | "routine" | "spam";`
   - `export interface ClassifyInput { from: string; subject: string; body: string; }`
   - A `FIELD_CAP = 200` / `BODY_CAP = 2000` clip (bound prompt cost; reuse the `clip` pattern from `briefing.ts:52`).
   - A `SYSTEM_INSTRUCTION` const array (`.join("\n")`, same shape as `briefing.ts:145`) instructing: classify the single message into EXACTLY one of the six categories; return STRICT JSON `{ "category": "<one of the six>" }`, no prose/fences; define each category (invoice = a supplier/sales invoice document; creditNote = a credit note, often referencing a voyage/Gefo reference number; voyageSummary = voyage details / voyage summary from the operations mailbox; important/routine/spam as in briefing).
   - `export async function classifyMessage(input: ClassifyInput, opts: ChatOptions = {}): Promise<InboxCategory>` — build `messages: ChatMessage[]` (system + a user message with clipped From/Subject/Body), call `await complete(messages, opts)`, parse defensively (strip a ```json fence like `briefing.ts:108`, `JSON.parse` in try/catch), validate `parsed.category` is one of the six literals, return it; on any parse failure or unrecognized value return `"routine"`.
2. Write `inboxClassifier.test.ts`. `vi.mock("@/lib/openrouter/client")` so `complete` is a `vi.fn`. Assert: (a) `complete` returning `'{"category":"creditNote"}'` → `classifyMessage` returns `"creditNote"`; (b) returning a ```json-fenced payload still parses; (c) returning `"not json"` → returns `"routine"`; (d) returning `'{"category":"banana"}'` → returns `"routine"`.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "inboxClassifier"` → `0`
- `npx vitest run src/lib/mail/inboxClassifier.test.ts` → all pass
- `grep -c "from \"@/lib/openrouter/client\"" src/lib/mail/inboxClassifier.ts` → `1` (reuses existing complete(), no new SDK)

**Context:** Read @src/lib/mail/briefing.ts @src/lib/openrouter/client.ts @.planning/scope-m6.md

---

## Task 3 — Scan orchestration (list → classify → markProcessed → stage)
**Wave:** 2
**Persona:** backend
**Files:**
- CREATE `src/lib/mail/inboxScan.ts` — exports `runInboxScan` + `ScanSummary` type.
- CREATE `src/lib/mail/inboxScan.test.ts` — orchestration + idempotency tests with IMAP, classifier, processedMessages, and stagePendingAction mocked.
**Depends on:** Task 1, Task 2

**Why:** REQ-29's core: orchestrate the scan over the two fixed mailboxes (`admin@aquavoy.com` for credit notes, `rice@aquavoy.com` for voyage details — m6-onedrive-discovery.md), skipping already-processed UIDs, classifying each new message, recording it processed BEFORE staging (so a retried cron never double-stages — relevant-learnings), and staging ONE `pending_actions` row per financial message (scope-m6 Phase 5: "one staged action per email"). Staged proposals must use `principal: "Wency"` so they surface in his existing home-page action-stack — the `pending_actions` table CHECK-constrains `principal` to `'Wency' | 'Jeanette'` (`supabase/migrations/0010_pending_actions.sql:17`), and `/api/actions` lists per-principal (`src/app/api/actions/route.ts:21`).

**Acceptance Criteria:**
- `runInboxScan()` lists recent mail from both `admin@aquavoy.com` and `rice@aquavoy.com` via the IMAP `listEmails` adapter (`src/lib/mail/imap.ts:274`), and for each message NOT already processed: classifies it, calls `markProcessed` BEFORE any `stagePendingAction`, and for the three financial categories stages exactly one pending action.
- An already-processed `(mailbox, uid)` is skipped — `classifyMessage` and `stagePendingAction` are NOT called for it (idempotency).
- Each staged action uses `principal: "Wency"` and the matching tool: `creditNote`/`invoice` → `record_finance_entry`; `voiceSummary`/`voyageSummary` → `record_voyage_entry`; an email with a savable attachment → `save_email_attachment`. (Tools are staged for human confirmation only — `runInboxScan` NEVER calls `executeConfirmedAction`.)
- `runInboxScan` returns a `ScanSummary` envelope `{ scanned, skipped, staged, byMailbox }` and per-message errors never abort the batch (one bad message is caught and counted, mirroring `runDue`'s per-row try/catch at `src/lib/mail/scheduled.ts:214-245`).

**Action:**
1. Write `inboxScan.ts`. Imports: `{ listEmails, readEmail }` from `@/lib/mail/imap`; `{ classifyMessage, type InboxCategory }` from `./inboxClassifier`; `{ markProcessed, isAlreadyProcessed }` from `./processedMessages`; `{ stagePendingAction }` from `@/lib/agents/pendingActions`.
   - `const SCAN_PRINCIPAL = "Wency";` `const MAILBOXES = ["admin@aquavoy.com", "rice@aquavoy.com"] as const;`
   - `const FINANCIAL: InboxCategory[] = ["invoice", "creditNote", "voyageSummary"];`
   - `export interface ScanSummary { scanned: number; skipped: number; staged: number; errors: number; byMailbox: Record<string, { scanned: number; staged: number }>; }`
   - `export async function runInboxScan(): Promise<ScanSummary>`:
     - For each mailbox in `MAILBOXES`: `const emails = await listEmails(mailbox, "inbox", 20);`
     - For each `e` of `emails`, in a try/catch (catch → `errors++`, continue):
       - `if (await isAlreadyProcessed(mailbox, e.uid)) { skipped++; continue; }`
       - Fetch the body: `const detail = await readEmail(mailbox, "inbox", e.uid);`
       - `const category = await classifyMessage({ from: e.from, subject: e.subject, body: detail.body });`
       - `await markProcessed({ mailbox, uid: e.uid, messageId: null, category });` — **BEFORE staging**.
       - `if (!FINANCIAL.includes(category)) { scanned++; continue; }` — non-financial: processed but not staged.
       - Map category → tool + summary and call `stagePendingAction({ principal: SCAN_PRINCIPAL, tool, args, summary })`:
         - `creditNote` / `invoice` → `tool: "record_finance_entry"`, `args` partial `{ company: null, direction: category === "creditNote" ? "income" : "expense", sourceName: e.from, sourceRef: e.subject, description: e.subject, mailbox, uid: e.uid }`, `summary: \`Inbox scan: ${category} from ${e.from} — "${e.subject}". Review and book to the finance ledger.\`` (the human fills the company/amount at confirm time; this is a proposal, NOT an auto-write).
         - `voyageSummary` → `tool: "record_voyage_entry"`, `args` `{ company: null, mailbox, uid: e.uid, sourceRef: e.subject }`, `summary: \`Inbox scan: voyage summary from ${e.from} — "${e.subject}". Review and record the voyage entry.\``
       - If the message has attachments (`detail.attachments.length > 0`) AND it is `invoice`/`creditNote`, ALSO note it in the summary so the operator knows a `save_email_attachment` follow-up is available — but stage only ONE action per email (scope-m6: one staged action per email). Do NOT stage a second `save_email_attachment` row.
       - `staged++; scanned++;` and update `byMailbox`.
     - Return the `ScanSummary`.
   - Do NOT import or call `executeConfirmedAction` anywhere in this file.
2. Write `inboxScan.test.ts`. `vi.mock` all four collaborators (`@/lib/mail/imap`, `./inboxClassifier`, `./processedMessages`, `@/lib/agents/pendingActions`). Assert:
   - (idempotency) when `isAlreadyProcessed` returns `true` for a UID, `classifyMessage` and `stagePendingAction` are NOT called for it and `skipped` increments.
   - (ordering) for a fresh financial message, `markProcessed` is called BEFORE `stagePendingAction` (use `vi.fn` call-order assertion, e.g. compare `mock.invocationCallOrder`).
   - (one-per-email) a `creditNote` with attachments produces exactly ONE `stagePendingAction` call (not two).
   - (principal) every `stagePendingAction` call is made with `principal: "Wency"`.
   - (resilience) a message whose `classifyMessage` throws increments `errors` and does NOT abort the loop (a following message still gets processed).
   - (no auto-execute) `executeConfirmedAction` is never imported — assert by `grep` in the Validation step below, not in the test.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "inboxScan"` → `0`
- `npx vitest run src/lib/mail/inboxScan.test.ts` → all pass
- `grep -c "executeConfirmedAction" src/lib/mail/inboxScan.ts` → `0` (scan NEVER executes — it only stages)
- `grep -c "\"Wency\"\|SCAN_PRINCIPAL = \"Wency\"" src/lib/mail/inboxScan.ts` → `≥ 1`
- `grep -c "admin@aquavoy.com\|rice@aquavoy.com" src/lib/mail/inboxScan.ts` → `2` (both fixed mailboxes targeted)

**Context:** Read @src/lib/mail/imap.ts @src/lib/agents/pendingActions.ts @src/lib/mail/scheduled.ts @.planning/m6-onedrive-discovery.md @.planning/scope-m6.md

---

## Task 4 — Cron route + proxy allowlist + vercel.json schedule
**Wave:** 3
**Persona:** backend
**Files:**
- CREATE `src/app/api/mail/scan/run/route.ts` — CRON_SECRET-gated GET handler.
- MODIFY `src/proxy.ts` — add `/api/mail/scan/run` to `ALLOWLIST` (line 30-37) + update the route-guard doc comment (line 8-15).
- MODIFY `vercel.json` — add the `/api/mail/scan/run` cron at `0 */6 * * *`.
**Depends on:** Task 3

**Why:** REQ-29's "~4×/day" trigger. This mirrors the existing scheduled-run cron EXACTLY (`src/app/api/mail/scheduled/run/route.ts`): CRON_SECRET bearer gate + `ok`/`fail` envelope. The PRIOR-BUG guard (memory `cron-allowlist-bug-prod`): a new cron path that is NOT in `src/proxy.ts` `ALLOWLIST` is 401'd by the proxy before its handler runs — `src/proxy.test.ts` already auto-asserts every `vercel.json` cron path is in the allowlist, so forgetting either breaks that test. `0 */6 * * *` runs every 6 hours = 4×/day.

**Acceptance Criteria:**
- `GET /api/mail/scan/run` with `Authorization: Bearer <CRON_SECRET>` returns `{ ok: true, data: <ScanSummary> }`; without it (or with a wrong token) returns `401 { ok: false, error: "Unauthorized" }` — identical gate to `src/app/api/mail/scheduled/run/route.ts:15-21`.
- `ALLOWLIST` in `src/proxy.ts` contains `/api/mail/scan/run`.
- `vercel.json` `crons` contains `{ "path": "/api/mail/scan/run", "schedule": "0 */6 * * *" }`.
- `src/proxy.test.ts` passes (the existing regression test that locks vercel.json crons ↔ allowlist in lock-step).

**Action:**
1. Write `src/app/api/mail/scan/run/route.ts` by mirroring `scheduled/run/route.ts` line-for-line: `import { NextRequest } from "next/server"`, `import { ok, fail } from "@/lib/http"`, `import { runInboxScan } from "@/lib/mail/inboxScan"`, `import * as Sentry from "@sentry/nextjs"`. `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`. In `GET(req)`: read `authorization` header, compare to `Bearer ${process.env.CRON_SECRET}`, `fail("Unauthorized", 401)` on mismatch or missing secret; else `try { return ok(await runInboxScan()); } catch (err) { Sentry.captureException(err); return fail(err instanceof Error ? err.message : "Inbox scan failed", 500); }`.
2. Edit `src/proxy.ts`: add `"/api/mail/scan/run",` to the `ALLOWLIST` Set (after line 33 `"/api/mail/scheduled/run",`). Add a matching bullet to the doc comment block (lines 8-15) describing it as the inbox-scan cron runner guarded by its own CRON_SECRET check.
3. Edit `vercel.json`: append `{ "path": "/api/mail/scan/run", "schedule": "0 */6 * * *" }` to the `crons` array.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "scan/run"` → `0`
- `grep -c "runInboxScan" src/app/api/mail/scan/run/route.ts` → `≥ 1` (route actually calls the scan orchestrator, not a stub)
- `grep -c "/api/mail/scan/run" src/proxy.ts` → `≥ 1`
- `grep -c "/api/mail/scan/run" vercel.json` → `1`
- `npx vitest run src/proxy.test.ts` → all pass (lock-step regression)
- `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"` → no error (valid JSON)

**Context:** Read @src/app/api/mail/scheduled/run/route.ts @src/proxy.ts @vercel.json @src/proxy.test.ts

---

## Success Criteria
- [ ] A cron (`/api/mail/scan/run`, `0 */6 * * *` in vercel.json, allowlisted in proxy.ts, CRON_SECRET-gated) runs ~4×/day.
- [ ] The scan reads `admin@aquavoy.com` and `rice@aquavoy.com`, classifies each new message via the LLM (`inboxClassifier`, separate from briefing), and is idempotent on `(mailbox, uid)` via `processed_messages` (markProcessed commits BEFORE staging).
- [ ] Financial messages (invoice / creditNote / voyageSummary) are staged as exactly ONE `pending_actions` row each (principal `"Wency"`, tool `record_finance_entry` / `record_voyage_entry`), surfacing automatically in the existing home-page action-stack via `/api/actions`.
- [ ] The scan NEVER calls `executeConfirmedAction` — no financial write happens without human confirmation (ADR-003).
- [ ] A per-message error (classification failure, IMAP read error, staging failure) is caught, increments `errors` in ScanSummary, and never aborts the batch — remaining messages in the same run still process.
- [ ] `processed_messages` has RLS on, no policies (constitution); `tsc` clean; all new tests + `proxy.test.ts` pass.

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0018_processed_messages.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — RLS on, no policies (constitution)
**Check type:** command-exit
**Command:** `grep -c "enable row level security" supabase/migrations/0018_processed_messages.sql && grep -c "create policy" supabase/migrations/0018_processed_messages.sql`
**Expected:** First line `1`, second line `0`
**Fail if:** RLS not enabled, or any policy is declared (table must be service-role-only)

### Contract for Task 1 — unique idempotency key
**Check type:** grep-match
**Command:** `grep -c "unique (mailbox, uid)\|unique(mailbox, uid)\|unique (mailbox,uid)" supabase/migrations/0018_processed_messages.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no UNIQUE(mailbox,uid), idempotency key not enforced at the DB

### Contract for Task 1 — store tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/processedMessages.test.ts 2>&1 | tail -3`
**Expected:** Exit 0, tests pass
**Fail if:** Any test fails

### Contract for Task 2 — classifier reuses complete() (no new SDK)
**Check type:** grep-match
**Command:** `grep -c "from \"@/lib/openrouter/client\"" src/lib/mail/inboxClassifier.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — classifier does not use the existing OpenRouter complete()

### Contract for Task 2 — classifier tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/inboxClassifier.test.ts 2>&1 | tail -3`
**Expected:** Exit 0, tests pass
**Fail if:** Any test fails (incl. malformed-reply → "routine" degradation)

### Contract for Task 3 — scan never auto-executes
**Check type:** grep-match
**Command:** `grep -c "executeConfirmedAction" src/lib/mail/inboxScan.ts`
**Expected:** `0`
**Fail if:** Non-zero — the scan imports/calls the executor; financial writes would bypass human confirmation (CRITICAL, ADR-003)

### Contract for Task 3 — both fixed mailboxes targeted
**Check type:** command-exit
**Command:** `grep -c "admin@aquavoy.com" src/lib/mail/inboxScan.ts && grep -c "rice@aquavoy.com" src/lib/mail/inboxScan.ts`
**Expected:** Each line `≥ 1`
**Fail if:** Either mailbox missing — scan does not cover the credit-note and voyage-details sources

### Contract for Task 3 — staged under a valid principal that surfaces in the stack
**Check type:** grep-match
**Command:** `grep -c "Wency" src/lib/mail/inboxScan.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — staged actions would violate the pending_actions principal CHECK and never appear in the home-page action-stack

### Contract for Task 3 — scan orchestration + idempotency tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/inboxScan.test.ts 2>&1 | tail -3`
**Expected:** Exit 0, tests pass (incl. skip-already-processed, markProcessed-before-stage ordering, one-action-per-email)
**Fail if:** Any test fails

### Contract for Task 4 — cron route exists and is CRON_SECRET-gated
**Check type:** grep-match
**Command:** `test -f src/app/api/mail/scan/run/route.ts && grep -c "CRON_SECRET" src/app/api/mail/scan/run/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Route missing, or no CRON_SECRET bearer gate (would be public)

### Contract for Task 4 — route wires runInboxScan (not a stub)
**Check type:** grep-match
**Command:** `grep -c "runInboxScan" src/app/api/mail/scan/run/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — route exists but scan orchestration is not called

### Contract for Task 4 — proxy allowlist updated (prior-bug guard)
**Check type:** grep-match
**Command:** `grep -c "/api/mail/scan/run" src/proxy.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — proxy would 401 the cron before its handler runs (the cron-allowlist-bug-prod regression)

### Contract for Task 4 — vercel.json cron added at 4×/day
**Check type:** grep-match
**Command:** `grep -c "0 \\*/6 \\* \\* \\*" vercel.json`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no ~4×/day schedule registered

### Contract for Task 4 — allowlist ↔ vercel.json lock-step
**Check type:** command-exit
**Command:** `npx vitest run src/proxy.test.ts 2>&1 | tail -3`
**Expected:** Exit 0, tests pass
**Fail if:** Any test fails — a vercel.json cron path is not allowlisted

### Contract for whole phase — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation error
