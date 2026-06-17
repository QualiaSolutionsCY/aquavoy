---
phase: 3
goal: "A QA checklist is produced and committed covering the headline M1–M3 flows, each row with steps + expected result + a Status/Tester/Date column the operator fills on prod, and a code-evidence column citing the prior verification that already proves the invariant."
tasks: 2
waves: 1
---

# Phase 3: Final QA

**Goal:** A committed QA checklist (`docs/qa-checklist.md`) lists every headline flow across M1–M3 — auth gate, agent chat with tool trace, confirm/undo a destructive action, send/schedule mail via the IMAP stack, OneDrive list+download, and all three management pages at 375px — each row carrying concrete steps, an expected result, a code-evidence citation (file:line or archived verification) for invariants already proven, and a Status/Tester/Date column the operator fills when they run it on production. A companion `docs/qa-automated-gate.md` records the automated pre-checks (typecheck + test suite) the developer ran and committed at handoff.

**Why this phase:** Handoff QA in this environment is the *authored, grounded checklist* — the operator owns the live prod execution and sign-off. We cannot run the auth-gated, key-dependent live flows from here (no creds, no live OpenRouter/Gemini/Tavily session), so we deliver the artifact the operator executes against, with code-level evidence pre-attached wherever a prior phase verification already proved the invariant.

---

## Task 1 — Author and commit the headline QA checklist
**Wave:** 1
**Persona:** none
**Files:** `docs/qa-checklist.md` (create)
**Depends on:** none

**Why:** REQ-21 requires a committed checklist covering every headline flow with steps + expected result + a Status/Tester/Date column. The operator runs these on production and signs off; the deliverable from this environment is the authored, grounded document — including a code-evidence column citing the archived verification that already proves each invariant at code level.

**Acceptance Criteria:**
- `docs/qa-checklist.md` exists and opens with an intro paragraph that explicitly states: the live flows are executed on the production URL **by the operator** (the app is auth-gated, named-principal login, and depends on live OpenRouter/Gemini/Tavily keys + Microsoft Graph + IMAP/SMTP — they cannot be run from the build environment), and that the Status/Tester/Date columns are left blank for the operator to fill on prod. No tester name or date is pre-filled. No claim that a live prod run already happened.
- The document contains a Markdown table for **each** of these six flow groups, each row with the columns `Flow | Steps | Expected | Code-evidence | Status | Tester | Date`:
  1. **Auth gate** — rows for: valid login lands on chat; wrong credentials rejected; unauthenticated `/api/*` returns 401 JSON; unauthenticated page redirects to `/login`; logout clears session. Code-evidence cites `src/proxy.ts:21` (allowlist), `src/proxy.ts:34-38` (401 vs redirect), and archived `.planning/archive/milestone-1-trust-and-hardening/phase-1-verification.md` (PASS, 14/14).
  2. **Agent chat with tool trace** — row for: send a chat message that triggers a OneDrive- or mail-backed tool, get a streamed reply, and expand the trace disclosure row to see the per-tool calls + model label. Code-evidence cites `src/app/page.tsx:114` (`traceOpen` state), `src/app/page.tsx:617` (`trace-row`), `src/app/api/traces/[id]/route.ts` (trace fetch), and M2 verification.
  3. **Confirm / undo a destructive action** — rows for: agent stages a send/delete (does NOT auto-execute inside the tool loop); operator clicks Confirm to execute; operator clicks Undo where reversible; Undo declined when already sent. Code-evidence cites `src/app/page.tsx:127` (`pending` state) / `:714` (Confirm button), `src/lib/agents/executeConfirmedAction.ts:33`, ADR-003 (`.planning/decisions/ADR-003-enforced-confirm-undo.md`), and archived `.planning/archive/milestone-2-agent-depth/phase-3-verification.md` (PASS).
  4. **Send mail via the IMAP stack** — row for: send an email from a named company mailbox; an `outlook`-stack mailbox is refused with the no-silent-fallback message. Code-evidence cites `src/app/api/mail/send/route.ts` (POST + Zod schema), `src/lib/agents/executeConfirmedAction.ts:110-112` (`mailStack !== "imap"` guard, ADR-004/REQ-16).
  5. **Schedule mail + cron drain** — row for: schedule an email; confirm the per-minute Vercel cron drains it; an `outlook`-stack scheduled row is refused. Code-evidence cites `vercel.json` (`/api/mail/scheduled/run`, `* * * * *`), `src/app/api/mail/scheduled/run/route.ts:14-20` (CRON_SECRET bearer check), `src/lib/mail/scheduled.ts:83-85` (stack guard).
  6. **OneDrive list + download** — row for: list files via the agent/Files page; download a file (server redirects to a short-lived pre-authenticated Microsoft CDN URL). Code-evidence cites `src/app/api/onedrive/files/route.ts`, `src/app/api/onedrive/download/route.ts` (redirect to `getDownloadUrl`).
  7. **Mobile layout at 375px** — one row per page (Emails / Files / Prep): each renders at 375px with no horizontal overflow, shows skeleton-on-load / inline "Could not load — Retry" on 5xx / non-empty empty state, and every interactive target is ≥ 44×44px. Code-evidence cites `src/app/globals.css:331` (`.btn.close` min-height 44px) and archived `.planning/archive/milestone-3-operations-polish/phase-3-verification.md` (PASS, 13/13).
- No row in any table has a placeholder like "TBD", "TODO", or "FIXME" in the Flow / Steps / Expected / Code-evidence columns (those columns are fully authored). The Status / Tester / Date columns are intentionally blank for the operator.
- A short "How to use this checklist" closing section tells the operator: run each row on the production URL, mark Status Pass/Fail, fill Tester + Date, and that any Fail must be resolved and re-tested before the milestone closes (per REQ-21 success criterion 3).

**Action:**
1. Create `docs/qa-checklist.md`. Open with `# Aquavoy — Handoff QA Checklist` and the caveat intro paragraph described above (operator runs on prod; environment cannot execute live flows; Status/Tester/Date left blank).
2. Write one `## {Flow group}` heading + Markdown table per the seven sub-areas above (six flow groups; group 7 "Mobile layout" holds three page rows). Header row: `| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |`. Steps must be concrete operator actions (e.g. "Open `/login`, enter a valid operator credential, submit"); Expected must be the observable result (e.g. "Redirected to `/` chat surface; session cookie set"). Fill the Code-evidence cell with the exact `file:line` / archived-verification citations enumerated in the Acceptance Criteria. Leave Status / Tester / Date cells empty (` | | |`).
3. Add a closing `## How to use this checklist` section per the final Acceptance Criterion.
4. Do not pre-fill any tester name or date. Do not assert a prod run occurred.

**Validation:** (builder self-check)
- `test -f docs/qa-checklist.md && echo EXISTS` → `EXISTS`
- `grep -c '| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |' docs/qa-checklist.md` → ≥ 6 (one header per flow-group table; mobile group may merge the three pages into one table, so accept ≥ 6)
- `grep -c 'src/proxy.ts\|executeConfirmedAction.ts\|onedrive/download\|scheduled/run\|globals.css:331\|phase-3-verification' docs/qa-checklist.md` → ≥ 6 (code-evidence citations present)
- `grep -ci 'TODO\|FIXME\|TBD' docs/qa-checklist.md` → `0`

**Context:** Read @.planning/PROJECT.md, @.planning/ROADMAP.md, @src/proxy.ts, @src/app/api/mail/scheduled/run/route.ts, @src/lib/agents/executeConfirmedAction.ts, @.planning/decisions/ADR-003-enforced-confirm-undo.md, @.planning/decisions/ADR-004-mail-stack.md, @.planning/archive/milestone-1-trust-and-hardening/phase-1-verification.md, @.planning/archive/milestone-2-agent-depth/phase-3-verification.md, @.planning/archive/milestone-3-operations-polish/phase-3-verification.md

---

## Task 2 — Record the committed automated QA gate (typecheck + tests)
**Wave:** 1
**Persona:** none
**Files:** `docs/qa-automated-gate.md` (create)
**Depends on:** none

**Why:** The one portion of QA that CAN be executed from the build environment is the automated gate — `npm run typecheck` (tsc) and `npm test` (vitest). Recording the committed evidence of these passing at handoff separates the deterministic developer-run pre-checks from the operator's live prod execution, and gives the client a record that the code-level invariants compiled and tested clean at handoff.

**Acceptance Criteria:**
- `docs/qa-automated-gate.md` exists and documents the two automated commands the developer runs at handoff: `npm run typecheck` (expected exit 0, zero TS errors) and `npm test` (expected exit 0, all vitest suites pass), with the exact commands copy-pasteable.
- The document records the latest run result observed at authoring time: `npx tsc --noEmit` exited 0; `vitest run` reported 12 test files / 59 tests passed — and states this is the developer-run automated gate, distinct from the operator's live prod flows in `docs/qa-checklist.md`.
- The document explicitly notes the boundary: these gates prove the code compiles and the seam-level tests pass; they do NOT exercise the live auth-gated, key-dependent prod flows — those are the operator's checklist (`docs/qa-checklist.md`).
- No placeholder text (`TODO`/`FIXME`/`TBD`) remains.

**Action:**
1. Create `docs/qa-automated-gate.md` with `# Aquavoy — Automated QA Gate (developer-run, committed at handoff)`.
2. Document the two commands in a small table: `Gate | Command | Expected`, rows `Typecheck | npm run typecheck | exit 0, zero TS errors` and `Test suite | npm test | exit 0, all vitest suites pass`.
3. Add a "Last run at handoff" line recording: tsc `--noEmit` exit 0; vitest 12 files / 59 tests passed.
4. Add a one-paragraph boundary note pointing to `docs/qa-checklist.md` as the operator's live-prod surface.

**Validation:** (builder self-check)
- `test -f docs/qa-automated-gate.md && echo EXISTS` → `EXISTS`
- `npm run typecheck` → exits 0
- `npm test` → exits 0
- `grep -c 'qa-checklist.md' docs/qa-automated-gate.md` → ≥ 1 (cross-reference present)
- `grep -ci 'TODO\|FIXME\|TBD' docs/qa-automated-gate.md` → `0`

**Context:** Read @package.json, @.planning/ROADMAP.md

---

## Success Criteria
- [ ] `docs/qa-checklist.md` is committed and covers all six headline flow groups (auth gate; agent chat + tool trace; confirm/undo; mail send + schedule/cron; OneDrive list+download; mobile at 375px on Emails/Files/Prep), one row per flow, columns `Flow | Steps | Expected | Code-evidence | Status | Tester | Date`.
- [ ] Every Flow/Steps/Expected/Code-evidence cell is authored with concrete content; Code-evidence cites a real `file:line` or archived verification for each invariant already proven at code level. Status/Tester/Date are left blank for the operator (no pre-filled names or dates, no false claim of a live prod run).
- [ ] The intro states the operator executes the live flows on production and the build environment cannot.
- [ ] `docs/qa-automated-gate.md` records the developer-run automated gate (typecheck + tests, both passing) and points to the checklist for the live-prod portion.
- [ ] `npm run typecheck` and `npm test` both exit 0.

---

## Verification Contract

### Contract for Task 1 — QA checklist exists
**Check type:** file-exists
**Command:** `test -f docs/qa-checklist.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — all six flow-group tables present
**Check type:** command-exit
**Command:** `grep -c '| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |' docs/qa-checklist.md`
**Expected:** ≥ 6
**Fail if:** Fewer than 6 flow tables — a headline flow group is missing its row(s)

### Contract for Task 1 — code-evidence citations present
**Check type:** grep-match
**Command:** `grep -Ec 'src/proxy\.ts|executeConfirmedAction\.ts|onedrive/download|scheduled/run|globals\.css:331|phase-3-verification' docs/qa-checklist.md`
**Expected:** Non-zero (≥ 6)
**Fail if:** Returns < 6 — the Code-evidence column is not grounded in real file:line / archived verifications

### Contract for Task 1 — no placeholders in authored columns
**Check type:** command-exit
**Command:** `grep -ci 'TODO\|FIXME\|TBD' docs/qa-checklist.md`
**Expected:** `0`
**Fail if:** Any placeholder text remains in the document

### Contract for Task 1 — operator caveat present (no false prod-run claim)
**Check type:** grep-match
**Command:** `grep -Eic 'operator|production' docs/qa-checklist.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the intro does not state the operator runs the flows on production

### Contract for Task 2 — automated gate doc exists
**Check type:** file-exists
**Command:** `test -f docs/qa-automated-gate.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 2 — typecheck gate passes
**Check type:** command-exit
**Command:** `npm run typecheck`
**Expected:** exit 0
**Fail if:** Any TypeScript compilation error

### Contract for Task 2 — test suite passes
**Check type:** command-exit
**Command:** `npm test`
**Expected:** exit 0
**Fail if:** Any vitest suite fails

### Contract for Task 2 — cross-reference to checklist
**Check type:** grep-match
**Command:** `grep -c 'qa-checklist.md' docs/qa-automated-gate.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the automated gate doc does not point to the operator's live-prod checklist
