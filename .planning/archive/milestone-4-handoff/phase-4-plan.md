---
phase: 4
goal: "Deliver the committed handover artifacts — operator walkthrough, credential & ownership handover checklist, acceptance sign-off template, and post-handover access-removal checklist — that make the live human handover ceremony to Wency & Jeanette executable. (REQ-22)"
tasks: 2
waves: 1
---

# Phase 4: Knowledge Transfer + Acceptance

**Goal:** The repo contains the prepared, accurate handover artifacts the project needs for the closing ceremony: a step-by-step operator walkthrough for Wency & Jeanette, a credential & ownership handover checklist (every account/key + how the client verifies they hold it), a written acceptance sign-off template tying back to the M1–M3 exit criteria, and a post-handover Qualia access-removal checklist.

**Why this phase:** This is the FINAL phase. The actual handover is a human/business ceremony — delivering a walkthrough to two people, transferring credential ownership, granting Vercel deploy access, obtaining a written signature, and removing Qualia's access. An agent cannot perform or attest to any of those. What it CAN deliver — and what this phase delivers — is the committed documents that make that ceremony executable, with all human-action items left as un-checked boxes and blank signature/date lines. Nothing is pre-checked, no signature is fabricated, no access removal is claimed.

> **Scope honesty (read before building both tasks):** Every checkbox and signature line in these documents stays BLANK. You are writing the templates the humans fill in during the live ceremony, not recording a ceremony that happened. Do not pre-check any `[ ]`, do not write a name/date/signature into a signature block, do not claim Qualia access was removed. The intro of each document must state plainly that it is a prepared handover artifact and that the live ceremony + sign-off are performed by humans after this phase.

## Task 1 — Operator walkthrough for Wency & Jeanette
**Wave:** 1
**Persona:** none
**Files:** `docs/handover/operator-walkthrough.md` (create — a numbered getting-started guide for the two named operators that points into `docs/operator-runbook.md` for depth)
**Depends on:** none

**Why:** Success criterion 1 (REQ-22) requires a walkthrough covering login, starting a chat, reading the tool-trace row, confirm/undo, managing the Emails page, searching OneDrive from Files, and drafting from Prep — with a checklist confirming the session occurred. The runbook (`docs/operator-runbook.md`) already documents these surfaces in depth; the walkthrough is the short ceremony script that sequences them and gives the trainer a per-topic "covered" checkbox to tick live.

**Acceptance Criteria:**
- A reader opening `docs/handover/operator-walkthrough.md` sees an intro stating it is the prepared walkthrough script and that the session itself is delivered live to Wency & Jeanette (not recorded here as done).
- The document has a numbered walkthrough covering, in order, every topic from REQ-22 criterion 1: logging in (`/login`), starting a chat (`/`), reading the tool-trace disclosure row, the confirm/undo flow, managing the `/emails` page, searching OneDrive from `/files`, and drafting an email on `/prep` — each step links into the matching section of `docs/operator-runbook.md` rather than duplicating it.
- A "Session coverage checklist" table at the end has one row per topic with an un-checked `[ ]` box and blank Attendee / Date / Trainer columns — nothing pre-filled.
- No `TODO`, `FIXME`, `placeholder`, or `not implemented` text anywhere in the file.

**Action:**
- Create `docs/handover/operator-walkthrough.md`. Open with an `## About this document` intro: one paragraph stating this is the prepared walkthrough script for the live handover session with Wency and Jeanette; the live session and any recording of attendance happen during the ceremony and are NOT pre-filled here.
- Add `## Walkthrough` with a numbered list (one item per REQ-22 topic, in this order): 1. Log in at `/login`; 2. Start a chat at `/`; 3. Read the tool-trace disclosure row; 4. Confirm / Cancel / Undo a staged action; 5. Manage the 12 company mailboxes from `/emails`; 6. Search & browse OneDrive from `/files`; 7. Draft a 1:1 email on `/prep`. Each item is 2–3 plain-language sentences (no developer jargon) and ends with a link into the matching section of the runbook, e.g. `See [Operator runbook §2 — Confirm and Undo](../operator-runbook.md#2-confirm-and-undo--the-safety-rule-for-risky-actions)`. Verify each anchor against the headings in `docs/operator-runbook.md` before writing it.
- Add `## Session coverage checklist` — a Markdown table with columns `| Topic | Covered | Attendee | Date |` and one row per numbered topic above, each `Covered` cell containing `[ ]` and `Attendee`/`Date` cells empty.
- Do NOT duplicate runbook content; the walkthrough sequences and links, the runbook explains.

**Validation:** (builder self-check)
- `test -f docs/handover/operator-walkthrough.md && echo EXISTS` → `EXISTS`
- `grep -ci "tool-trace\|/login\|/emails\|/files\|/prep\|confirm" docs/handover/operator-walkthrough.md` → non-zero (all REQ-22 topics present)
- `grep -c "operator-runbook.md" docs/handover/operator-walkthrough.md` → ≥ 5 (links into the runbook, not duplicated)
- `grep -Eic "TODO|FIXME|placeholder|not implemented" docs/handover/operator-walkthrough.md` → `0`
- `grep -c "\[ \]" docs/handover/operator-walkthrough.md` → ≥ 7 (one un-checked box per topic) and `grep -c "\[x\]" docs/handover/operator-walkthrough.md` → `0` (nothing pre-checked)

**Context:** Read @docs/operator-runbook.md (the depth source the walkthrough links into — confirm section headings/anchors), @.planning/ROADMAP.md (Phase 4 success criterion 1), @README.md (page routes).

**Design:** Not applicable — Markdown documentation only, no `.tsx/.jsx/.css/.scss/.html` touched.

## Task 2 — Credential handover checklist, acceptance sign-off, and Qualia access-removal checklist
**Wave:** 1
**Persona:** none
**Files:** `docs/handover/credential-handover.md` (create — the full ownership-transfer checklist, acceptance sign-off template, and post-handover access-removal checklist)
**Depends on:** none

**Why:** REQ-22 criteria 2–5 require: (2) a credential handover checklist confirming the client holds every account/key; (3) the client has independent Vercel deploy access; (4) a written acceptance sign-off tying to the M1–M3 exit criteria; (5) removal/downgrade of Qualia's access after handover. None of these can be performed or attested by an agent — but all four need a committed, accurate template so the humans can execute and record them. This task produces that template with every human-action item un-checked and every signature line blank.

**Acceptance Criteria:**
- A reader opening `docs/handover/credential-handover.md` sees an intro stating it is the prepared handover artifact and that the transfers, the Vercel access grant, the signature, and the Qualia access removal are performed by humans during/after the ceremony — none are pre-completed here.
- A `## Credential & ownership handover checklist` table lists every credential and access item from REQ-22 criterion 2, each with an un-checked `[ ]` box and a concrete "How to verify the client holds it" step. Items: Supabase project (URL + service-role key), Vercel project access/ownership, Microsoft Azure app registration (client ID + secret), the 12 mailbox IMAP/SMTP credentials (stored encrypted in `mail_accounts`), `OPENROUTER_API_KEY`, `GOOGLE_API_KEY` (Gemini direct), `TAVILY_API_KEY`, plus the operational secrets `SESSION_SECRET`, `ENCRYPTION_KEY`, `OPERATOR_CREDENTIALS`, `CRON_SECRET` (sourced from `docs/env-reference.md`).
- A `## Independent Vercel deploy access` section gives the exact steps for the client to be added as a Vercel team member/owner and to run `vercel --prod` themselves — with an un-checked verification box.
- An `## Acceptance sign-off` section restates the M1, M2, and M3 exit criteria as un-checked acceptance rows and provides a signature block with blank `Name`, `Role`, `Date`, and `Signature` lines — nothing filled in.
- A `## Post-handover: remove Qualia access` checklist enumerates each access surface Qualia must drop/downgrade (Supabase, Vercel, Microsoft app registration, mailbox creds, API keys, repo write) as un-checked boxes — not marked done.
- No `TODO`, `FIXME`, `placeholder`, or `not implemented` text; no pre-checked box; no fabricated signature/date.

**Action:**
- Create `docs/handover/credential-handover.md`. Open with `## About this document`: one paragraph stating this is the prepared handover artifact; the credential transfers, Vercel access grant, written sign-off, and Qualia access removal are carried out by people during and after the live ceremony, and every checkbox/signature line below is intentionally left blank to be completed then.
- `## Credential & ownership handover checklist`: a table `| Item | Where it lives | How to verify the client holds it | Done |`. One row per credential/access item listed in the Acceptance Criteria. Pull exact variable names and locations from `docs/env-reference.md` (e.g. `SUPABASE_SERVICE_ROLE_KEY` server-only; mailbox passwords in `mail_accounts` encrypted with `ENCRYPTION_KEY`; `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `SESSION_SECRET`, `OPERATOR_CREDENTIALS`, `CRON_SECRET`, `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`). Each `Done` cell is `[ ]`. The 12 mailbox row must note the addresses are listed in `docs/operator-runbook.md §4` and the passwords are held encrypted in Supabase `mail_accounts`, not in env.
- `## Independent Vercel deploy access`: numbered steps to add the client to the Vercel project as member/owner (Vercel Dashboard → Project → Settings → Members) and to deploy with `vercel link` + `vercel --prod`; end with an un-checked `[ ]` "Client deployed `vercel --prod` themselves and the deploy succeeded" verification line.
- `## Acceptance sign-off`: three subsections (M1 — auth + credential encryption + migration integrity + green seam tests; M2 — durable memory + inline document understanding + enforced confirm/undo; M3 — observability/tool-trace + mail-stack decision (ADR-004) + mobile UX across Emails/Files/Prep), each a short un-checked `[ ]` acceptance row quoting the matching exit-criterion intent. Then a signature block, e.g.:
  ```
  Accepted on behalf of Aquavoy Shipping / Faial BV:

  Name: ______________________
  Role: ______________________
  Date: ______________________
  Signature: ______________________
  ```
  Leave all blank.
- `## Post-handover: remove Qualia access`: a checklist of un-checked `[ ]` items — remove/downgrade Qualia from Supabase project, Vercel team, Microsoft app registration owners, rotate any shared API keys the client now owns, downgrade repo write access — each phrased as an action to be done after sign-off, none marked complete.

**Validation:** (builder self-check)
- `test -f docs/handover/credential-handover.md && echo EXISTS` → `EXISTS`
- `grep -c "SUPABASE_SERVICE_ROLE_KEY\|OPENROUTER_API_KEY\|GOOGLE_API_KEY\|TAVILY_API_KEY\|MICROSOFT_CLIENT_ID\|ENCRYPTION_KEY\|SESSION_SECRET\|OPERATOR_CREDENTIALS\|CRON_SECRET\|mail_accounts" docs/handover/credential-handover.md` → non-zero (credential list grounded in env-reference)
- `grep -ci "vercel --prod" docs/handover/credential-handover.md` → non-zero (independent deploy access documented)
- `grep -ci "Signature" docs/handover/credential-handover.md` → non-zero (sign-off block present)
- `grep -c "\[x\]" docs/handover/credential-handover.md` → `0` (no box pre-checked)
- `grep -Eic "TODO|FIXME|placeholder|not implemented" docs/handover/credential-handover.md` → `0`
- `grep -Ec "Name: _|Date: _|Signature: _" docs/handover/credential-handover.md` → non-zero (signature lines blank, not filled)

**Context:** Read @docs/env-reference.md (authoritative credential/key list + which are server-only), @docs/operator-runbook.md (§4 — the 12 mailbox addresses; mail_accounts encryption), @.planning/ROADMAP.md (Phase 4 success criteria 2–5 + M4 exit criteria), @.planning/JOURNEY.md (M1/M2/M3 goals + M1 exit criteria), @.planning/decisions/ADR-004-mail-stack.md (mail-stack decision referenced in M3 acceptance row).

**Design:** Not applicable — Markdown documentation only.

## Success Criteria
- [ ] `docs/handover/operator-walkthrough.md` exists: numbered walkthrough covering all REQ-22 topics (login, chat, tool-trace, confirm/undo, Emails, Files, Prep), each linking into `docs/operator-runbook.md`, with a session-coverage checklist whose boxes are all blank.
- [ ] `docs/handover/credential-handover.md` exists: a credential & ownership handover checklist covering every account/key from `docs/env-reference.md` with a verify step per item, an independent-Vercel-deploy section, an acceptance sign-off tying to M1/M2/M3 exit criteria with a blank signature block, and a post-handover Qualia access-removal checklist.
- [ ] No checkbox is pre-checked, no signature/date is fabricated, and no document claims a live human action (transfer, sign-off, access removal) has been performed — each document's intro states the ceremony is performed by humans after this phase.
- [ ] No `TODO`/`FIXME`/`placeholder` text in either file.

## Verification Contract

### Contract for Task 1 — Operator walkthrough (exists)
**Check type:** file-exists
**Command:** `test -f docs/handover/operator-walkthrough.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — Operator walkthrough (REQ-22 topic coverage)
**Check type:** grep-match
**Command:** `grep -Eci "tool-trace|/login|/emails|/files|/prep|confirm" docs/handover/operator-walkthrough.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — walkthrough does not reference the REQ-22 walkthrough topics

### Contract for Task 1 — Operator walkthrough (links into runbook, not duplicated)
**Check type:** grep-match
**Command:** `grep -c "operator-runbook.md" docs/handover/operator-walkthrough.md`
**Expected:** Non-zero (≥ 5)
**Fail if:** Returns < 5 — walkthrough duplicates runbook depth instead of linking into it

### Contract for Task 1 — Operator walkthrough (no pre-checked boxes)
**Check type:** grep-match
**Command:** `grep -c "\[x\]" docs/handover/operator-walkthrough.md`
**Expected:** `0`
**Fail if:** Returns non-zero — a session-coverage box was pre-checked (fabricated attendance)

### Contract for Task 1 — Operator walkthrough (no stubs)
**Check type:** command-exit
**Command:** `grep -Eic "TODO|FIXME|placeholder|not implemented" docs/handover/operator-walkthrough.md`
**Expected:** `0`
**Fail if:** Returns non-zero — placeholder/stub text remains in the doc

### Contract for Task 2 — Credential handover (exists)
**Check type:** file-exists
**Command:** `test -f docs/handover/credential-handover.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 2 — Credential handover (credential list grounded in env-reference)
**Check type:** grep-match
**Command:** `grep -c "SUPABASE_SERVICE_ROLE_KEY\|OPENROUTER_API_KEY\|GOOGLE_API_KEY\|TAVILY_API_KEY\|MICROSOFT_CLIENT_ID\|ENCRYPTION_KEY\|SESSION_SECRET\|OPERATOR_CREDENTIALS\|CRON_SECRET\|mail_accounts" docs/handover/credential-handover.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — checklist omits the actual credentials/keys from docs/env-reference.md

### Contract for Task 2 — Credential handover (independent Vercel deploy)
**Check type:** grep-match
**Command:** `grep -ci "vercel --prod" docs/handover/credential-handover.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — independent client deploy access (REQ-22 criterion 3) not documented

### Contract for Task 2 — Credential handover (sign-off block present, not fabricated)
**Check type:** grep-match
**Command:** `grep -Ec "Name: _|Date: _|Signature: _" docs/handover/credential-handover.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — signature/date lines are missing OR have been filled in (fabricated sign-off)

### Contract for Task 2 — Credential handover (no pre-checked boxes)
**Check type:** grep-match
**Command:** `grep -c "\[x\]" docs/handover/credential-handover.md`
**Expected:** `0`
**Fail if:** Returns non-zero — a handover/access-removal box was pre-checked (claims a human action was done)

### Contract for Task 2 — Credential handover (no stubs)
**Check type:** command-exit
**Command:** `grep -Eic "TODO|FIXME|placeholder|not implemented" docs/handover/credential-handover.md`
**Expected:** `0`
**Fail if:** Returns non-zero — placeholder/stub text remains in the doc
