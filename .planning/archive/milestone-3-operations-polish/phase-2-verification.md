---
phase: 2
result: PASS
gaps: 0
---

# Phase 2 Verification — Mail Stack Decision

## Contract Results

Machine contract already passed 17/17 (`.planning/evidence/phase-2-contract-run.json`). Re-executed
all checks inline via direct tool reads and greps. Results confirmed:

| Task | Check | Command | Result | Notes |
|------|-------|---------|--------|-------|
| T1 | file-exists | `test -f .planning/decisions/ADR-004-mail-stack.md` | PASS | File exists, 80 lines |
| T1 | grep-match keep-both | `grep -ci "keep-both"` | PASS | 4 matches |
| T1 | grep-match VAL-4/VAL-5 | `grep -c "VAL-5\|VAL-4"` | PASS | 5 matches |
| T1 | grep-match date | `grep -c "2026-06-17"` | PASS | 1 match |
| T2 | file-exists | `test -f supabase/migrations/0012_mail_stack.sql` | PASS | File exists, 31 lines |
| T2 | grep-match idempotent | `grep -c "add column if not exists"` | PASS | 1 match |
| T2 | grep-match check constraint | `grep -cE "mail_stack[^;]*check"` | PASS | Match on `add constraint mail_accounts_mail_stack_check` line |
| T2 | grep-match mailStack in accounts.ts | `grep -c "mailStack"` | PASS | 4 matches |
| T2 | ADR-004 comment smtp.ts | `grep -c "ADR-004"` | PASS | 1 match |
| T2 | ADR-004 comment imap.ts | `grep -c "ADR-004"` | PASS | 1 match |
| T2 | ADR-004 comment outlook.ts | `grep -c "ADR-004"` | PASS | 1 match |
| T2 | tsc --noEmit | exit 0 | PASS | 0 errors |
| T3 | mailStack in executeConfirmedAction | grep | PASS | line 110 |
| T3 | mailStack in scheduled.ts | grep | PASS | line 83 |
| T3 | REQ-16/ADR-004 in executeConfirmedAction | grep | PASS | line 109 |
| T3 | no microsoft/outlook in executeConfirmedAction | grep | PASS | 0 matches; only microsoft/onedrive + microsoft/connections |
| T3 | tests pass | `npx vitest run` | PASS | 59/59 |

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| ADR-004 exists, dated, names keep-both, cites VAL-4/VAL-5 (REQ-15) | 5 | 5 | 5 | 5 | PASS |
| mail_stack discriminator column + additive migration (REQ-16) | 5 | 5 | 5 | 5 | PASS |
| One ownership-annotated adapter contract per stack | 5 | 5 | 5 | 5 | PASS |
| Agent send/schedule assert 'imap', no silent fallback (REQ-16) | 5 | 5 | 5 | 5 | PASS |
| No route calls both stacks for the same operation | 5 | 5 | 5 | 5 | PASS |
| tsc passes and tests pass | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** No score below 3. All pass.

---

## Goal-Backward Verification

### Success Criterion 1 — ADR-004 (REQ-15)

**Level 2 — Artifacts:**
`.planning/decisions/ADR-004-mail-stack.md:1` — `# ADR-004 — Keep Both Mail Stacks, One Owner Per Operation (M3 · Phase 2)` — exists, 80 lines, substantive.

**Level 1 — Truths verified:**
- Dated: `.planning/decisions/ADR-004-mail-stack.md:2` — `**Date:** 2026-06-17` — PASS
- Status Accepted: `.planning/decisions/ADR-004-mail-stack.md:4` — `**Status:** Accepted` — PASS
- Names keep-both: `.planning/decisions/ADR-004-mail-stack.md:12` — `We keep both mail stacks and declare a single owner per operation` — PASS
- Cites VAL-5: `.planning/decisions/ADR-004-mail-stack.md:17` — `12 hardcoded company mailboxes... src/lib/mailboxes.ts:31-47`, **VAL-5** — PASS
- Cites VAL-4: `.planning/decisions/ADR-004-mail-stack.md:21` — `Graph/Outlook... VAL-4` — PASS
- Declares two owners: `.planning/decisions/ADR-004-mail-stack.md:38-41` — `IMAP/SMTP = authoritative for company mailboxes ... Outlook = user-personal drafting/send only. No agent tool, no company-mailbox access.` — PASS
- Alternatives rejected: `.planning/decisions/ADR-004-mail-stack.md:51-58` — converge-to-Graph and converge-to-IMAP both rejected with explicit rationale — PASS
- REQ-16 load-bearing note: `.planning/decisions/ADR-004-mail-stack.md:71-72` — `REQ-16 (no silent fallback) is enforced by the mail_stack discriminator column added in Task 2 plus the agent send/schedule stack assertion added in Task 3.` — PASS

**Level 3 — Wiring:** ADR is a decision document; no import wiring required. Content is self-consistent with the code that was actually produced.

---

### Success Criterion 2 — mail_stack discriminator column (REQ-16)

**Level 2 — Artifacts:**
`supabase/migrations/0012_mail_stack.sql:16` — `add column if not exists mail_stack text not null default 'imap';` — additive, idempotent, correct default.
`supabase/migrations/0012_mail_stack.sql:23-24` — `add constraint mail_accounts_mail_stack_check check (mail_stack in ('imap', 'outlook'));` — check constraint present, correct values.
`supabase/migrations/0012_mail_stack.sql:20-27` — `do $$ begin ... exception when duplicate_object then null; end $$;` — constraint add is guarded against re-run failures.

Migration correctness (Docker/Supabase down — verified by read):
- Column is `text not null default 'imap'`: existing rows all backfill to `'imap'` safely. `.planning/phase-2-context.md` confirmed all existing accounts are IMAP company mailboxes.
- `add column if not exists`: no failure on re-run.
- Check constraint wrapped in do-block: no failure on re-run even if constraint already exists.
- RLS: migration does not touch RLS policies; existing `mail_accounts` RLS remains unchanged (service-role-only, no public policies, consistent with 0003/0011 patterns per migration header comment at lines 1-13).

`src/lib/mail/accounts.ts:27` — `mailStack: 'imap' | 'outlook';` — field in `MailAccount` interface.
`src/lib/mail/accounts.ts:46` — `mail_stack: string | null;` — field in `AccountRow` (nullable for pre-migration rows, gracefully handled).
`src/lib/mail/accounts.ts:60` — `mailStack: row.mail_stack === 'outlook' ? 'outlook' : 'imap',` — safe default in `toMailAccount`.
`src/lib/mail/accounts.ts:115` — `"id, email, display_name, smtp_host, smtp_port, imap_host, imap_port, username, verified_at, mail_stack"` — `mail_stack` added to `listAccounts` select list.

**Level 3 — Wiring:** `toMailAccount` called by both `toMailAccountWithSecret` (line 65) and `listAccounts` (line 118). `loadAccountWithSecretByEmail` and `loadAccountWithSecret` both use `toMailAccountWithSecret`. All callers that resolve account credentials receive the `mailStack` field.

---

### Success Criterion 3 — Ownership-annotated adapter contracts

`src/lib/mail/smtp.ts:8` — `// ADR-004: authoritative stack for this operation — IMAP/SMTP owns company mailboxes` — PASS
`src/lib/mail/imap.ts:20` — `// ADR-004: authoritative stack for this operation — IMAP/SMTP owns company mailboxes` — PASS
`src/lib/microsoft/outlook.ts:8` — `// ADR-004: authoritative stack — Outlook is user-personal drafting/send only, never company mailboxes` — PASS

All three comments are on the exact files called out in Task 2. Comments are at the file top-level doc-block, self-documenting the ownership boundary for any future reader.

---

### Success Criterion 4 — Agent send/schedule assert 'imap', no silent fallback (REQ-16)

**send_email path:**
`src/lib/agents/executeConfirmedAction.ts:104-106` — `loadAccountWithSecretByEmail(from)` resolves account; non-null check.
`src/lib/agents/executeConfirmedAction.ts:109-113` — `// ADR-004 / REQ-16: no silent cross-stack fallback` comment followed by:
```
if (account.mailStack !== "imap") {
  throw new Error(`Mailbox "${from}" is owned by the ${account.mailStack} stack; the agent only sends company mail through IMAP/SMTP. No silent fallback (ADR-004 / REQ-16).`);
}
```
Guard fires **before** `sendMail` call at line 116. Error is operator-readable, names the mailbox and the offending stack, does not expose raw IMAP/Graph internals.

**schedule_email path:**
`src/lib/agents/executeConfirmedAction.ts:139` — `case "schedule_email"` delegates to `scheduleEmail(...)`. Guard is located in `scheduleEmail` itself at `src/lib/mail/scheduled.ts:82-87`:
```
// ADR-004 / REQ-16: no silent cross-stack fallback
if (account.mailStack !== "imap") {
  throw new Error(`Mailbox "${input.fromEmail}" is owned by the ${account.mailStack} stack; ...`);
}
```
Guard fires **before** the `db.from(TABLE).insert(...)` call at line 89. This is the correct placement — the check runs before the row enters the queue, not after.

**No Outlook import in agent send path:**
`src/lib/agents/executeConfirmedAction.ts:5-9` — imports are `onedrive`, `connections`, `accounts`, `smtp`, `scheduled`. No `microsoft/outlook` import. Confirmed by grep returning 0 matches.

---

## Adversarial Analysis: Agent-Reachable Send Paths

The question is whether any agent-reachable path can call `sendMail` (from `@/lib/mail/smtp`) or `sendMail` (from `@/lib/microsoft/outlook`) without the `account.mailStack !== "imap"` guard.

**All sendMail callers identified:**

1. `src/lib/agents/executeConfirmedAction.ts:116` — guarded at line 110. **BLOCKED** by REQ-16 guard.
2. `src/lib/mail/scheduled.ts:186` — called by `runDue()`. This is the **drain path** and is NOT guarded by a mailStack check in `runDue`. However, all rows in `scheduled_emails` must have been inserted via `scheduleEmail()`, which is guarded. Any `'outlook'` row would have been rejected at insert time. The drain path is therefore safe-by-invariant: if the DB check constraint and `scheduleEmail` guard are both in place, no `'outlook'` row can ever reach `runDue`. The `runDue` cron endpoint (`/api/mail/scheduled/run/route.ts`) is additionally protected by `CRON_SECRET` bearer token auth (`src/app/api/mail/scheduled/run/route.ts:15-19`), making it unreachable from the agent.
3. `src/app/api/mail/send/route.ts:30` — human-triggered HTTP POST. Uses `loadAccountWithSecret` (by `accountId`, not by email). Does **NOT** check `mailStack`. This is outside REQ-16 scope: REQ-16 is specifically about the agent not silently crossing stacks. This route is a human-facing UI operation (sending via a known account ID selected by a human operator). It is not on any agent tool dispatch path (`executeTool` → `executeConfirmedAction` is the only agent path; neither calls this HTTP route). Flagged as **LOW/informational** — see note below.
4. `src/app/api/outlook/send/route.ts:39` — calls `sendMail` from `@/lib/microsoft/outlook`. This is the user-personal Outlook path, not the IMAP path. It is completely separate from the IMAP stack and not reachable from any agent tool.

**Agent tool dispatch trace:**
- `openrouter/client.ts:369` — `executeTool(...)` is the only model-callable dispatch path.
- `src/lib/agents/onedriveTools.ts:597` — `executeTool` routes `send_email` and `schedule_email` to staging a `pending_actions` row, never calling `sendMail` or `scheduleEmail` directly.
- `src/lib/agents/pendingActions.ts:176` — `executeConfirmedAction(...)` is called only after human confirm via `/api/actions/confirm`, which is guarded.
- There is **no direct path** from `executeTool` to `sendMail` or to any HTTP route that calls `sendMail`.

**Conclusion:** No agent-reachable send path bypasses the `account.mailStack !== "imap"` guard. REQ-16 is enforced.

---

## Informational Finding (LOW — not a FAIL)

**Path:** `src/app/api/mail/send/route.ts:27-30`
**Observation:** Human-triggered send endpoint calls `loadAccountWithSecret(accountId)` then `sendMail(...)` without checking `account.mailStack`. If a human were to add an `'outlook'`-stack account to `mail_accounts` (which is currently impossible since `mail_accounts` only stores IMAP/SMTP credentials, and the `saveAccount` function at `accounts.ts:84-108` does not accept a `mailStack` parameter in its input), this route would send through SMTP for what's labeled an Outlook account.

This is **out of REQ-16 scope** — REQ-16 is explicitly about the agent not silently crossing stacks. The human operator route is a deliberate, human-confirmed action. No agent tool calls this route. The risk surface is minimal because (a) the `saveAccount` function has no `mailStack` input so Outlook-labeled rows cannot currently be created via normal flows, and (b) the check constraint on the DB column enforces that any manually inserted `'outlook'` row would need to store SMTP credentials, which contradicts the Outlook stack's Graph-OAuth model.

Severity: LOW per grounding.md — "naming inconsistency; minor perf (no user-visible impact)". Category score formula: 0/0/0/1 → ws=1 → score 5. Not a phase fail.

If a future migration allows Outlook accounts to be stored in `mail_accounts` (unlikely given the architectural separation), adding the guard to this route would be warranted.

---

### Success Criterion 5 — No route calls both stacks for the same operation

`src/lib/agents/executeConfirmedAction.ts:8-9` — imports only `sendMail` from `@/lib/mail/smtp` and `scheduleEmail` from `@/lib/mail/scheduled`. No Outlook import.
`src/app/api/outlook/send/route.ts:4` — imports only from `@/lib/microsoft/outlook`. No SMTP import.
`src/app/api/mail/send/route.ts:5` — imports only from `@/lib/mail/smtp`. No Outlook import.

No single route handler or function calls both stacks for the same send operation.

---

### Success Criterion 6 — tsc passes and tests pass

TypeScript: `npx tsc --noEmit` → no output, exit 0. PASS.

Tests: `npx vitest run` → `Test Files  12 passed (12) / Tests  59 passed (59)`. PASS.
Test suites specifically covering this phase: `src/lib/agents/onedriveTools.test.ts` (18 tests, all pass) and `src/lib/mail/scheduled.test.ts` (all pass within the 59 total).

---

## Code Quality

- TypeScript: PASS — 0 errors
- Stubs found: 0 — no TODO/FIXME/placeholder in touched files
- Empty handlers: 0
- Unused imports: 0
- Migration: additive only, idempotent, check constraint guarded against duplicate, column comment documents ADR-004 ownership
- Error messages: operator-readable, name offending mailbox and stack, include ADR/REQ reference

## Design Verification

Design Verification: N/A — Phase 2 contains no frontend tasks. All touched files are `.sql`, `.ts` (lib), and `.md` (planning). No `.tsx`, `.jsx`, `.css`, or `app/` component files modified.

---

## Verdict

PASS — Phase 2 goal achieved. All 6 success criteria scored 5 on all dimensions. Machine contract 17/17. TypeScript compiles. 59/59 tests pass.

The adversarial REQ-16 check confirms: every agent-reachable company-mail send path (direct `send_email` via `executeConfirmedAction` and `schedule_email` via `scheduleEmail`) guards `account.mailStack !== "imap"` before side-effect. The guard in `scheduleEmail` fires before the DB insert (line 83 before line 89). `executeConfirmedAction` imports from `@/lib/mail/smtp` only, never `@/lib/microsoft/outlook`. The human-triggered `/api/mail/send` route lacks the guard but is demonstrably out of REQ-16 scope (no agent tool dispatches to it) — flagged LOW/informational, not a fail.

Proceed to Phase 3.
