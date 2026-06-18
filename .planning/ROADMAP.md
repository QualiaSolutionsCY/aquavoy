# Roadmap · Milestone 4 · Handoff

**Project:** Aquavoy
**Milestone:** 4 of 4 (CURRENT — FINAL)
**Created:** 2026-06-17
**Phases:** 4
**Requirements covered:** REQ-19, REQ-20, REQ-21, REQ-22

See `JOURNEY.md` for the full project arc. This file is ONLY the current milestone's phases.

## Exit Criteria

What "shipped" means for this milestone:

- A new maintainer can orient themselves from the repo and docs alone — README, operator runbook, env-var reference, and ADR index all in place with no undocumented gaps.
- Vercel prod config, cron, env vars, and all 12 Supabase migrations (0001–0012) are confirmed applied and documented; RLS is on for every table; no secret sits client-side.
- End-to-end QA pass confirms all headline flows (auth, agent chat with tool trace, confirm/undo, mail send/schedule, OneDrive file ops, mobile layout on each management page) are verified with a pass/fail checklist.
- Client holds all credentials and access needed to own the system independently; written acceptance sign-off obtained.

---

## Phases

| # | Phase | Goal | Requirements | Status |
|---|-------|------|--------------|--------|
| 1 | Documentation Pass | Write the repo-level docs a maintainer or operator needs to get oriented from scratch | REQ-19 | ready |
| 2 | Deployment Hardening + Monitoring | Confirm and document the production deployment configuration; verify schema and security posture | REQ-20 | — |
| 3 | Final QA | End-to-end verification of all headline flows across M1–M3; produce a signed-off pass/fail checklist | REQ-21 | — |
| 4 | Knowledge Transfer + Acceptance | Operator walkthrough, credential handover, and written client acceptance sign-off | REQ-22 | — |

## Phase Details

### Phase 1: Documentation Pass

**Goal:** A developer or operator arriving at the repo cold can understand the app's architecture, operate the agent, and get a local dev environment running — without asking anyone — because the README, runbook, env-var reference, and ADR index are all accurate and complete.

**Requirements covered:**
- REQ-19: Maintainer/operator can orient from repo and docs alone — README, runbook, env-var reference, ADR index all present and accurate

**Success criteria** (observable behaviors):
1. `README.md` at repo root covers: what Aquavoy is, local dev setup (clone → env pull → `npm run dev`), the four pages (Chat / Emails / Files / Prep), and pointers to the operator runbook and ADR index — a developer with Next.js experience can run the app locally following only the README.
2. An operator runbook exists (e.g. `docs/operator-runbook.md`) covering: how to start and drive the agent chat, what the confirm/undo flow does and when it fires, how to read the tool-trace disclosure row, how to manage the 12 mailboxes from the Emails page, and how the OneDrive connection works (OAuth, what to do if the token expires).
3. An env-var reference exists listing every environment variable the app reads, its purpose, where the value comes from, and whether it is required or optional — no variable is undocumented.
4. `.planning/decisions/` contains ADR-001 through ADR-004; a short index in the README or a `docs/architecture.md` links to each ADR with a one-line summary so a reader knows what each decision covers without opening each file.
5. No "TODO", "FIXME", or placeholder text remains in any doc file introduced or updated during this phase.

**Depends on:** M3 shipped (all features stable before docs are written as final).

---

### Phase 2: Deployment Hardening + Monitoring

**Goal:** The production deployment is fully documented and verified: Vercel config and cron are correct, all 12 Supabase migrations are applied to prod, RLS is confirmed on every table, no secret is reachable from client code, and there is a documented monitoring approach so an incident does not go unnoticed.

**Requirements covered:**
- REQ-20: Production deployment verified and documented — Vercel + cron config, all 12 migrations applied, RLS on every table, no secret client-side, monitoring approach documented

**Success criteria** (observable behaviors):
1. `vercel.json` cron entry for the scheduled-email drain (`/api/mail/scheduled/run`) is present and the cron fires on schedule in production — confirmed by checking Vercel Dashboard cron logs for at least one successful run or by a `curl` triggering the endpoint with the correct `CRON_SECRET` and getting HTTP 200.
2. `npx supabase db diff --linked` against the production database returns no schema drift — all 12 migrations (0001_onedrive_connections through 0012_mail_stack) are applied and the live schema matches the migration files on disk.
3. Every table in production has RLS enabled — confirmed by `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'` returning `rowsecurity = true` for all rows.
4. A grep of the client bundle (`NEXT_PUBLIC_` variables and any files under `src/app/` or `src/components/`) finds zero references to `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `IMAP_*`, or `SMTP_*` — secrets are server-only.
5. A monitoring approach is documented: at minimum, the UptimeRobot monitor URL (`https://stats.uptimerobot.com/bKudHy1pLs`) is recorded in the README or runbook with instructions for the client to check it; any additional Vercel error alerts or log-drain config is noted.

**Depends on:** Phase 1 (docs in place before the deployment verification is recorded against them).

---

### Phase 3: Final QA

**Goal:** Every headline user flow introduced across M1–M3 is manually exercised on the production URL and marked pass or fail on a written checklist; all items pass before the milestone closes.

**Requirements covered:**
- REQ-21: End-to-end QA checklist produced and all items verified pass on production — covering auth, agent chat with tool trace, confirm/undo, mail send/schedule, OneDrive file ops, and mobile layout on each management page

**Success criteria** (observable behaviors):
1. A QA checklist document exists (e.g. `docs/qa-checklist.md`) with one row per flow covering: auth gate (login / wrong credentials rejected / logout), agent chat round-trip with a tool that calls OneDrive or mail and produces a visible tool-trace row, confirm/undo a destructive action (send or delete), send an email from a named mailbox, schedule an email and verify it drains via cron, list and download a OneDrive file, navigate each of the three management pages (Emails / Files / Prep) at 375 px without overflow.
2. Every row in the QA checklist has a "Pass" or "Fail" result and a tester name + date — no row is blank or left as "TBD".
3. All checklist items are marked Pass before this phase closes — any Fail must be resolved and re-tested within this milestone.
4. The QA checklist is committed to the repo so the client and future maintainers have a record of what was verified at handoff.

**Depends on:** Phase 2 (deployment verified before final QA runs against production).

---

### Phase 4: Knowledge Transfer + Acceptance

**Goal:** Wency and Jeanette can operate the system without Qualia assistance; the client holds every credential and access token needed to own the system; written acceptance sign-off is obtained tying back to the JOURNEY.md exit criteria.

**Requirements covered:**
- REQ-22: Operator walkthrough delivered, all credentials and ownership transferred to client, written acceptance sign-off obtained

**Success criteria** (observable behaviors):
1. A walkthrough session is held with Wency and Jeanette (or documented asynchronously) covering: logging in, starting a chat, reading the tool-trace row, using confirm/undo, managing the Emails page, searching OneDrive from the Files page, and using the Prep page to draft an email — a walkthrough summary or checklist exists confirming the session occurred.
2. A credential handover checklist exists and is completed, confirming the client holds: Supabase project credentials (URL + service role key), Vercel project access, Microsoft Azure app registration (client ID + secret for OneDrive OAuth), all 12 mailbox IMAP/SMTP credentials, OpenRouter API key, Gemini API key (if used directly), and Tavily API key.
3. The client has Vercel project ownership (is added as a team member or owner) and can independently trigger a `vercel --prod` deployment without Qualia.
4. A written acceptance sign-off document exists — signed (or explicitly acknowledged) by the client — stating that the delivered system meets the JOURNEY.md exit criteria for M1 (auth + encryption + migration integrity), M2 (memory + document understanding + confirm/undo), and M3 (observability + mail stack decision + mobile UX).
5. Qualia's own access tokens and developer accounts are removed or downgraded to read-only after handover is confirmed — no lingering developer-level write access to production data.

**Depends on:** Phase 3 (QA pass confirms the product is ready to hand off).

---

## Coverage Verification

Every requirement in this milestone maps to exactly one phase.

| Requirement | Phase | Covered? |
|-------------|-------|----------|
| REQ-19 | Phase 1 | ✓ |
| REQ-20 | Phase 2 | ✓ |
| REQ-21 | Phase 3 | ✓ |
| REQ-22 | Phase 4 | ✓ |

---

## When This Milestone Closes

This is the final milestone. On close:

1. All phase artifacts are archived to `.planning/archive/milestone-4-handoff/`
2. `tracking.json` `milestones[]` gets a summary entry (num, name, phases_completed, shipped_url, closed_at)
3. REQUIREMENTS.md marks M4 requirements as **Complete**
4. Client acceptance sign-off document is committed to `.planning/archive/` or `docs/`
5. Project is marked complete in `tracking.json`

---

*Last updated: 2026-06-17*
