---
phase: 2
goal: "The dual mail stack is formally documented as an intentional two-owner architecture with a single adapter contract per stack (keep-both), and REQ-16 (no silent fallback, runtime-discoverable authoritative stack) is implemented."
tasks: 3
waves: 2
---

# Phase 2: Mail Stack Decision

**Goal:** The dual mail stack (IMAP/SMTP + Graph/Outlook) is recorded as an intentional keep-both, two-owner architecture; each stack has a single ownership-annotated adapter contract; and the authoritative stack for any company mailbox is discoverable at runtime via a `mail_stack` discriminator, with the agent send/schedule paths asserting `'imap'` and surfacing a human-readable error instead of silently crossing stacks.
**Why this phase:** REQ-16 today is an *architectural* risk, not a live bug — `scout` confirmed `mail_accounts` records no stack discriminator (`phase-2-scout.md:7`). This phase makes the boundary explicit and enforced so a future change cannot silently route company mail through the wrong stack.

> All decisions D-01..D-05 are LOCKED in `.planning/phase-2-context.md`. No code is deleted (D-05); migrations are additive only.

## Task 1 — Record ADR-004 (the keep-both decision)
**Wave:** 1
**Persona:** architect
**Files:** `.planning/decisions/ADR-004-mail-stack.md` (create)
**Depends on:** none

**Why:** REQ-15 / D-03 require the dual-stack decision to be recorded as a dated ADR that names the chosen path and ties the rationale to VAL-4 and VAL-5 — future archaeology for why two stacks coexist instead of one.

**Acceptance Criteria:**
- `.planning/decisions/ADR-004-mail-stack.md` exists, dated `2026-06-17`, Phase `2`, Status `Accepted`.
- It names the chosen path explicitly as **keep-both** (not converge-to-Graph, not converge-to-IMAP).
- The Context/Decision sections cite VAL-5 (12-company-mailbox IMAP fleet, `src/lib/mailboxes.ts:31-47`) and VAL-4 (Graph delegated OAuth, `src/lib/microsoft/*`) as the reason neither stack can be deleted autonomously.
- It declares the two owners: IMAP/SMTP = authoritative for company mailboxes (aquavoy.com / faialbv.com); Outlook = user-personal drafting/send only, no agent tool, no company-mailbox access (D-02).
- The "Alternatives considered" section honestly rejects converge-to-Graph (kills 12 mailboxes) and converge-to-IMAP (low cost only if OneDrive stays, since Graph OAuth is shared with file browsing — `phase-2-scout.md:26-27`).
- A "Consequences" / load-bearing note states that REQ-16 is enforced by the `mail_stack` discriminator column added in Task 2 and the assertion added in Task 3.

**Action:** Copy the structure of `@.planning/decisions/_template.md` (Date, Phase, Status, Domain terms, Context, Decision, Consequences, Alternatives considered, Notes). Match the prose density of `@.planning/decisions/ADR-003-enforced-confirm-undo.md`. State the decision as one declarative sentence first ("We keep both mail stacks and declare a single owner per operation: IMAP/SMTP for company mailboxes, Outlook for user-personal mail only."), then expand. Pull the cited facts from `@.planning/phase-2-scout.md` and `@.planning/phase-2-context.md` — do not invent file paths; every cited path must already exist in the repo.

**Validation:** (builder self-check)
- `test -f .planning/decisions/ADR-004-mail-stack.md && echo EXISTS` → `EXISTS`
- `grep -ci "keep-both\|keep both" .planning/decisions/ADR-004-mail-stack.md` → ≥ 1
- `grep -c "VAL-5\|VAL-4" .planning/decisions/ADR-004-mail-stack.md` → ≥ 1
- `grep -c "2026-06-17" .planning/decisions/ADR-004-mail-stack.md` → ≥ 1

**Context:** Read @.planning/decisions/_template.md, @.planning/decisions/ADR-003-enforced-confirm-undo.md, @.planning/phase-2-scout.md, @.planning/phase-2-context.md, @.planning/PROJECT.md

## Task 2 — Add the `mail_stack` discriminator (migration + plumb-through + ownership comments)
**Wave:** 1
**Persona:** backend
**Files:** `supabase/migrations/0012_mail_stack.sql` (create), `src/lib/mail/accounts.ts` (modify), `src/lib/mail/smtp.ts` (modify — comment only), `src/lib/mail/imap.ts` (modify — comment only), `src/lib/microsoft/outlook.ts` (modify — comment only)
**Depends on:** none

**Why:** D-04 / REQ-16 require a runtime-discoverable authoritative stack. Today `mail_accounts` records no stack (`phase-2-scout.md:7`). An additive `mail_stack` column makes ownership a queryable fact, and the adapter ownership comments make the boundary readable in code. Task 3's assertion reads the value this task exposes.

**Acceptance Criteria:**
- A new migration `supabase/migrations/0012_mail_stack.sql` adds a `mail_stack text not null default 'imap'` column to `public.mail_accounts` with a check constraint restricting it to `('imap','outlook')`, using `add column if not exists` so it is idempotent (locked-learning: additive, mirror 0010/0011 style).
- The migration is independently re-runnable (no failure if applied twice) and applied via the Supabase/CI flow (a comment says so) — never hand-applied (constitution, D-05).
- `MailAccount` interface in `accounts.ts` gains a `mailStack: 'imap' | 'outlook'` field; `AccountRow` gains `mail_stack: string`; `toMailAccount` maps `row.mail_stack` → `mailStack` (defaulting to `'imap'` when null for pre-migration rows read mid-rollout).
- `src/lib/mail/smtp.ts`, `src/lib/mail/imap.ts`, and `src/lib/microsoft/outlook.ts` each carry a `// ADR-004: authoritative stack for this operation` ownership comment at the top of the file (smtp/imap = `imap`; outlook = `outlook`, user-personal only).
- `npx tsc --noEmit` passes — no type errors introduced by the new field.

**Action:**
1. Write `0012_mail_stack.sql` mirroring the header-comment + RLS-on style of `@supabase/migrations/0011_agent_traces.sql`. Body: `alter table public.mail_accounts add column if not exists mail_stack text not null default 'imap';` then a guarded check constraint, e.g. wrap `alter table ... add constraint mail_accounts_stack_chk check (mail_stack in ('imap','outlook'))` in a `do $$ begin ... exception when duplicate_object then null; end $$;` block so re-running does not fail. Add a `comment on column public.mail_accounts.mail_stack is '...'` explaining ADR-004 ownership.
2. In `accounts.ts`: add `mailStack: "imap" | "outlook";` to `MailAccount`, add `mail_stack: string;` to `AccountRow`, and in `toMailAccount` add `mailStack: (row.mail_stack === "outlook" ? "outlook" : "imap"),`. Add `mail_stack` to the explicit `select(...)` column list in `listAccounts`.
3. Add the `// ADR-004: authoritative stack for this operation — IMAP/SMTP owns company mailboxes` comment to the top doc-block of `smtp.ts` and `imap.ts`, and `// ADR-004: authoritative stack — Outlook is user-personal drafting/send only, never company mailboxes` to `outlook.ts`.

**Validation:** (builder self-check)
- `test -f supabase/migrations/0012_mail_stack.sql && echo EXISTS` → `EXISTS`
- `grep -c "mail_stack" supabase/migrations/0012_mail_stack.sql` → ≥ 2
- `grep -c "add column if not exists" supabase/migrations/0012_mail_stack.sql` → ≥ 1
- `grep -cE "mail_stack[^;]*check" supabase/migrations/0012_mail_stack.sql` → ≥ 1 (proves the check constraint exists)
- `grep -c "mailStack" src/lib/mail/accounts.ts` → ≥ 2
- `grep -c "ADR-004" src/lib/mail/smtp.ts` → ≥ 1
- `grep -c "ADR-004" src/lib/mail/imap.ts` → ≥ 1
- `grep -c "ADR-004" src/lib/microsoft/outlook.ts` → ≥ 1
- `npx tsc --noEmit` → exits 0

**Context:** Read @supabase/migrations/0003_mail_accounts.sql, @supabase/migrations/0011_agent_traces.sql, @src/lib/mail/accounts.ts, @src/lib/mail/smtp.ts, @src/lib/mail/imap.ts, @src/lib/microsoft/outlook.ts, @.planning/phase-2-context.md

## Task 3 — Enforce REQ-16: agent send/schedule asserts `'imap'`, no silent fallback
**Wave:** 2
**Persona:** backend
**Files:** `src/lib/agents/executeConfirmedAction.ts` (modify), `src/lib/mail/scheduled.ts` (modify)
**Depends on:** Task 2

**Why:** D-04 / REQ-16: the agent send path must assert the resolved account's authoritative stack is `'imap'` and return a human-readable error otherwise — no implicit cross-stack fallback. Without this the new discriminator is recorded but never read, leaving REQ-16 architecturally unenforced.

**Acceptance Criteria:**
- In `executeConfirmedAction.ts` `case "send_email"`: after `loadAccountWithSecretByEmail(from)` resolves a non-null account, if `account.mailStack !== "imap"` the code throws a human-readable `Error` (e.g. `Mailbox "<from>" is owned by the Outlook stack, which the agent cannot send through. Company mail must use an IMAP/SMTP account.`) — it does NOT fall back to any other send path.
- The same assertion guards `case "schedule_email"` (the scheduled queue is SMTP-only — `scheduled.ts:154-203` drains via SMTP), implemented inside `scheduleEmail` in `scheduled.ts` right after its existing `loadAccountWithSecretByEmail` null-check, so both the agent path and any other caller of `scheduleEmail` are protected.
- The thrown errors are operator-readable sentences (no raw IMAP/Graph exception leakage) and name the offending mailbox.
- No route or tool handler calls both the IMAP/SMTP send and the Outlook send for the same operation (verify: `executeConfirmedAction.ts` imports `sendMail` only from `@/lib/mail/smtp`, never from `@/lib/microsoft/outlook`).
- `npx tsc --noEmit` passes and the existing mail/agent test suites still pass.

**Action:**
1. In `executeConfirmedAction.ts`, in `case "send_email"`, immediately after the `if (!account) { throw ... }` block (current line ~107), add:
   `if (account.mailStack !== "imap") { throw new Error(\`Mailbox "${from}" is owned by the ${account.mailStack} stack; the agent only sends company mail through IMAP/SMTP. No silent fallback (ADR-004 / REQ-16).\`); }`
2. In `scheduled.ts` `scheduleEmail`, after the existing `if (!account) { throw ... }` block (current line ~80), add the same `account.mailStack !== "imap"` guard with an operator-readable message naming `input.fromEmail`.
3. Add a brief `// ADR-004 / REQ-16: no silent cross-stack fallback` comment above each new guard so the intent is readable.
4. Do NOT change the IMAP read tools (`list_emails`/`read_email`/`search_emails`/`list_mail_folders`) — they already resolve via `loadAccountWithSecretByEmail` and are inherently IMAP-only; the send/schedule paths are the only cross-stack-fallback risks.

**Validation:** (builder self-check)
- `grep -c "mailStack" src/lib/agents/executeConfirmedAction.ts` → ≥ 1
- `grep -c "mailStack" src/lib/mail/scheduled.ts` → ≥ 1
- `grep -c "REQ-16\|ADR-004" src/lib/agents/executeConfirmedAction.ts` → ≥ 1
- `grep -c "microsoft/outlook" src/lib/agents/executeConfirmedAction.ts` → 0 (no Outlook import in the agent send path)
- `npx tsc --noEmit` → exits 0
- `npx vitest run src/lib/agents/onedriveTools.test.ts src/lib/mail/scheduled.test.ts` → all pass

**Context:** Read @src/lib/agents/executeConfirmedAction.ts, @src/lib/mail/scheduled.ts, @src/lib/mail/accounts.ts, @.planning/phase-2-context.md

## Success Criteria
- [ ] ADR-004 exists, is dated, names keep-both, and ties rationale to VAL-4 and VAL-5 (REQ-15).
- [ ] `mail_accounts` has a `mail_stack` discriminator column ('imap'|'outlook', default 'imap') applied via an additive tracked migration; the authoritative stack is discoverable at runtime (REQ-16).
- [ ] Each mail stack has one ownership-annotated adapter contract (`// ADR-004: authoritative stack` on smtp.ts, imap.ts, outlook.ts).
- [ ] The agent send and schedule paths assert the resolved account's stack is 'imap' and return a human-readable error otherwise — no silent cross-stack fallback (REQ-16).
- [ ] No route calls both stacks for the same operation.
- [ ] `npx tsc --noEmit` passes and existing mail/agent tests pass.

## Verification Contract

### Contract for Task 1 — ADR-004 exists
**Check type:** file-exists
**Command:** `test -f .planning/decisions/ADR-004-mail-stack.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — names keep-both
**Check type:** grep-match
**Command:** `grep -ci "keep-both\|keep both" .planning/decisions/ADR-004-mail-stack.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — ADR does not name the chosen path

### Contract for Task 1 — rationale tied to VAL-4/VAL-5 and dated
**Check type:** grep-match
**Command:** `grep -c "VAL-5\|VAL-4" .planning/decisions/ADR-004-mail-stack.md && grep -c "2026-06-17" .planning/decisions/ADR-004-mail-stack.md`
**Expected:** Both non-zero
**Fail if:** Either returns 0 — rationale not tied to validated capabilities, or undated

### Contract for Task 2 — migration adds idempotent column
**Check type:** grep-match
**Command:** `grep -c "add column if not exists" supabase/migrations/0012_mail_stack.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — migration is missing or not idempotent

### Contract for Task 2 — check constraint restricts values
**Check type:** grep-match
**Command:** `grep -cE "mail_stack[^;]*check" supabase/migrations/0012_mail_stack.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no value check constraint on mail_stack

### Contract for Task 2 — accounts.ts exposes mailStack
**Check type:** grep-match
**Command:** `grep -c "mailStack" src/lib/mail/accounts.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns < 2 — field not added to interface and mapper

### Contract for Task 2 — ownership comment on smtp.ts
**Check type:** grep-match
**Command:** `grep -c "ADR-004" src/lib/mail/smtp.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — smtp.ts missing the ADR-004 ownership comment

### Contract for Task 2 — ownership comment on imap.ts
**Check type:** grep-match
**Command:** `grep -c "ADR-004" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — imap.ts missing the ADR-004 ownership comment

### Contract for Task 2 — ownership comment on outlook.ts
**Check type:** grep-match
**Command:** `grep -c "ADR-004" src/lib/microsoft/outlook.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — outlook.ts missing the ADR-004 ownership comment

### Contract for Task 2 — compiles
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation errors

### Contract for Task 3 — send path asserts stack
**Check type:** grep-match
**Command:** `grep -c "mailStack" src/lib/agents/executeConfirmedAction.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — send path does not read the discriminator

### Contract for Task 3 — schedule path asserts stack
**Check type:** grep-match
**Command:** `grep -c "mailStack" src/lib/mail/scheduled.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — schedule path does not read the discriminator

### Contract for Task 3 — no cross-stack import in agent send path
**Check type:** grep-match
**Command:** `grep -c "microsoft/outlook" src/lib/agents/executeConfirmedAction.ts`
**Expected:** `0`
**Fail if:** Non-zero — the agent send path imports the Outlook stack (cross-stack fallback risk)

### Contract for Task 3 — tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/agents/onedriveTools.test.ts src/lib/mail/scheduled.test.ts 2>&1 | grep -c "FAIL"`
**Expected:** `0`
**Fail if:** Any test file fails
