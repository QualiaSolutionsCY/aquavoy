---
phase: 2
goal: "Production deployment is verified and documented: Vercel cron config correct, all 12 Supabase migrations applied, RLS on every table, no secret reachable client-side, monitoring approach recorded with a stable health target."
tasks: 2
waves: 2
---

# Phase 2: Deployment Hardening + Monitoring

**Goal:** A maintainer can open one document and confirm the production posture is sound — cron config, migration coverage, RLS-on-every-table, server-only secrets — and an uptime monitor has a stable, unauthenticated `/api/health` target with a documented monitoring approach.

**Why this phase:** At handoff the client must be able to trust the deployment without re-auditing the code. The code-level posture is already compliant (audited during planning); this phase makes that posture *legible and verifiable* and closes the two real gaps — no monitoring is documented anywhere, and there is no clean health endpoint for an uptime monitor to hit.

**Grounding note (planner-verified, applies to both tasks):**
- All 8 tables created in migrations have RLS enabled — 8 `create table` (`supabase/migrations/0001…0011`) matched by 8 `enable row level security`. No table is missing RLS.
- `SUPABASE_SERVICE_ROLE_KEY` is referenced only in `src/lib/supabase/server.ts:15` and `src/lib/env.ts:60`; there is no `src/lib/supabase/client.ts`; no `"use client"` component references any secret. Secrets are structurally server-only.
- Both cron routes guard on `CRON_SECRET`: `src/app/api/mail/scheduled/run/route.ts:18` and `src/app/api/memory/sweep/route.ts:35`, each returning 401 on mismatch.
- **The roadmap success criteria name a cron path `/api/cron/send-scheduled` that does NOT exist.** The real cron paths in `vercel.json` are `/api/mail/scheduled/run` and `/api/memory/sweep`. Document the real paths; do not invent the stale one.
- Live-prod migration apply + `pg_tables.rowsecurity` confirmation cannot run from here (Docker/local Supabase down, prod is remote, no linked CLI auth). These are captured as **operator runbook commands the client runs**, not faked results.

---

## Task 1 — Add `/api/health` route + document the monitoring approach
**Wave:** 1
**Persona:** backend
**Files:**
- Create `src/app/api/health/route.ts` — exports `GET`, returns HTTP 200 JSON `{ ok: true, status: "ok", ts: <ISO string> }`, no secrets, no DB call.
- Modify `src/proxy.ts` — add `/api/health` to the `ALLOWLIST` set (line 19) so the uptime monitor reaches it without a session cookie.
- Create `docs/monitoring.md` — the monitoring approach for this Vercel deployment.
**Depends on:** none

**Why:** REQ-20 requires a documented monitoring approach, and an uptime monitor needs a stable, unauthenticated target. Today every route except `/login`, `/api/login`, `/api/mail/scheduled/run` returns 401 to an unauthenticated caller (`src/proxy.ts:33`), so an UptimeRobot HTTP check against the homepage would 302-redirect to `/login` and a check against any API would 401 — neither is a clean liveness signal. A dedicated `/api/health` route gives the monitor a deterministic 200.

**Acceptance Criteria:**
- `GET /api/health` returns HTTP 200 with a JSON body containing `"ok":true` and a timestamp, with no authentication required (it is in the proxy allowlist).
- The health route reads no environment secret and makes no database/network call — it is a pure liveness probe that cannot leak credentials or fail on a DB hiccup.
- `docs/monitoring.md` records: the UptimeRobot public status page `https://stats.uptimerobot.com/bKudHy1pLs`, instructions for the client to point an UptimeRobot HTTP(s) monitor at `<prod-url>/api/health` expecting 200, where to view Vercel cron-execution logs (Vercel Dashboard → Project → Cron Jobs / Logs), and how to view function/runtime errors (Vercel Dashboard → Logs).
- No `TODO`/`FIXME`/placeholder text remains in `docs/monitoring.md`.

**Action:**
1. Create `src/app/api/health/route.ts` following the existing minimal-route pattern in `src/app/api/auth/me/route.ts`: `import { ok } from "@/lib/http"`, set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`, and `export function GET() { return ok({ status: "ok", ts: new Date().toISOString() }); }`. `ok()` (`src/lib/http.ts:5`) already wraps the body as `{ ok: true, ... }` — do not add auth, do not read `process.env`, do not import the Supabase client.
2. In `src/proxy.ts`, change the `ALLOWLIST` set (currently `new Set<string>(["/login", "/api/login", "/api/mail/scheduled/run"])` at line 19) to also include `"/api/health"`. Add a one-line comment in the doc-block allowlist list above mirroring the existing format.
3. Write `docs/monitoring.md` with sections: **Uptime monitoring** (UptimeRobot status page URL + how to add an HTTP monitor on `/api/health` expecting 200), **Cron monitoring** (the two crons from `vercel.json` — `/api/mail/scheduled/run` every minute and `/api/memory/sweep` every 5 minutes — and where Vercel surfaces their execution logs), **Error visibility** (Vercel Dashboard → Logs for runtime/function errors). Use concrete paths and the real cron schedules; no placeholders.

**Validation:** (builder self-check)
- `npx tsc --noEmit` → exits 0
- `grep -c "/api/health" src/proxy.ts` → ≥ 1
- `grep -c "process.env" src/app/api/health/route.ts` → 0 (route reads no secret)
- `grep -c "stats.uptimerobot.com/bKudHy1pLs" docs/monitoring.md` → ≥ 1
- `grep -cE "TODO|FIXME|placeholder" docs/monitoring.md` → 0

**Context:** Read @src/app/api/auth/me/route.ts @src/lib/http.ts @src/proxy.ts @vercel.json @.planning/PROJECT.md

## Task 2 — Deployment hardening audit document
**Wave:** 2
**Persona:** security
**Files:**
- Create `docs/deployment.md` — the binding deployment-posture record for handoff.
**Depends on:** Task 1 (references the `/api/health` endpoint created in Task 1 as the uptime target)

**Why:** REQ-20 requires the production deployment to be verified and documented so the client can own it. The code-level posture is the binding, here-verifiable deliverable; the live-prod confirmations (migrations applied, `rowsecurity=true` per table) are remote-only and must be captured as exact operator commands the client runs, never as fabricated output.

**Acceptance Criteria:**
- `docs/deployment.md` lists all 12 migrations (`0001_onedrive_connections` … `0012_mail_stack`) and states that every table created in them has RLS enabled, with the per-table file:line evidence (8 tables: `onedrive_connections`, `recipients`, `mail_accounts`, `chat_messages`, `scheduled_emails`, `memory_facts`, `pending_actions`, `agent_traces` — note `0006` and `0012` are `alter table`, not new tables).
- The doc records the secret posture: `SUPABASE_SERVICE_ROLE_KEY` lives only in `src/lib/supabase/server.ts` (server-only, no `client.ts` sibling exists), and no `"use client"` component references any secret — with the grep command an auditor re-runs to confirm.
- The doc records the Vercel cron config exactly as it is in `vercel.json` (`/api/mail/scheduled/run` `* * * * *`, `/api/memory/sweep` `*/5 * * * *`) and the `CRON_SECRET` bearer guard at `src/app/api/mail/scheduled/run/route.ts:18` and `src/app/api/memory/sweep/route.ts:35`.
- The doc contains a **Live production verification (operator runs)** section with the exact CLI commands the client executes against the linked prod project: `npx supabase migration list --linked` (expect all 12 listed as applied with no untracked/missing), `npx supabase db diff --linked` (expect no schema drift), and the RLS query `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';` (expect `rowsecurity = true` for every row). These are presented as steps to run, not as results.
- The doc records the cron-fired-in-prod check: hit `<prod-url>/api/mail/scheduled/run` with header `Authorization: Bearer $CRON_SECRET` expecting HTTP 200, or confirm a successful run in Vercel Dashboard → Cron Jobs logs.
- The doc points to `docs/monitoring.md` for the monitoring approach and names `/api/health` as the uptime target.
- No `TODO`/`FIXME`/placeholder text remains in `docs/deployment.md`.

**Action:**
1. Write `docs/deployment.md` with sections: **Migrations & RLS** (table the 8 tables with their `create table` file:line and matching `enable row level security` file:line; note `0006_chat_sessions` and `0012_mail_stack` are `alter table` migrations adding columns/constraints, not new tables), **Secret posture** (service-role-server-only finding + the re-runnable grep), **Cron configuration** (the two crons + CRON_SECRET guard citations), **Live production verification (operator runs)** (the `npx supabase migration list --linked`, `npx supabase db diff --linked`, and `pg_tables` RLS query as operator steps), **Cron prod confirmation** (curl-with-CRON_SECRET or Vercel cron logs), **Monitoring** (link to `docs/monitoring.md`, name `/api/health`).
2. Do NOT run a deploy and do NOT run the live `--linked` commands yourself — Docker/local Supabase is down and prod is remote; this phase documents the operator steps, it does not execute them. State this constraint plainly in the doc's intro.
3. Every codebase claim in the doc carries `file:line` evidence (use the grounding citations above; re-grep to confirm line numbers are current before writing).

**Validation:** (builder self-check)
- `test -f docs/deployment.md && echo EXISTS` → `EXISTS`
- `grep -c "supabase migration list --linked" docs/deployment.md` → ≥ 1
- `grep -c "rowsecurity" docs/deployment.md` → ≥ 1
- `grep -c "src/lib/supabase/server.ts" docs/deployment.md` → ≥ 1
- `grep -c "/api/health" docs/deployment.md` → ≥ 1
- `grep -cE "TODO|FIXME|placeholder" docs/deployment.md` → 0

**Context:** Read @vercel.json @src/proxy.ts @src/lib/supabase/server.ts @src/app/api/mail/scheduled/run/route.ts @src/app/api/memory/sweep/route.ts @docs/env-reference.md @.planning/PROJECT.md

## Success Criteria
- [ ] `/api/health` returns HTTP 200 unauthenticated (added to proxy allowlist) and reads no secret.
- [ ] `docs/monitoring.md` records the UptimeRobot status page, the `/api/health` monitor target, the cron logs location, and Vercel error visibility — no placeholders.
- [ ] `docs/deployment.md` records the 12 migrations + per-table RLS evidence, the server-only secret posture with a re-runnable grep, the real cron config + CRON_SECRET guard citations, and the live-prod operator verification commands.
- [ ] No deploy is triggered and no live `--linked` command output is fabricated — live-prod confirmation is captured as operator runbook steps.
- [ ] `npx tsc --noEmit` exits 0.

## Verification Contract

### Contract for Task 1 — health route exists
**Check type:** file-exists
**Command:** `test -f src/app/api/health/route.ts && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — health route wired into proxy allowlist
**Check type:** grep-match
**Command:** `grep -c "/api/health" src/proxy.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — route exists but unauthenticated callers still get 401/redirect

### Contract for Task 1 — health route reads no secret
**Check type:** grep-match
**Command:** `grep -c "process.env" src/app/api/health/route.ts`
**Expected:** `0`
**Fail if:** Non-zero — liveness probe touches an env secret

### Contract for Task 1 — monitoring doc records UptimeRobot status page
**Check type:** grep-match
**Command:** `grep -c "stats.uptimerobot.com/bKudHy1pLs" docs/monitoring.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — monitoring approach not documented

### Contract for Task 1 — no placeholders in monitoring doc
**Check type:** command-exit
**Command:** `! grep -qE "TODO|FIXME|placeholder" docs/monitoring.md`
**Expected:** exit 0 (pattern absent)
**Fail if:** Pattern present

### Contract for Task 2 — deployment doc exists
**Check type:** file-exists
**Command:** `test -f docs/deployment.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 2 — operator migration-list command documented
**Check type:** grep-match
**Command:** `grep -c "supabase migration list --linked" docs/deployment.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — live-prod migration verification step missing

### Contract for Task 2 — RLS verification query documented
**Check type:** grep-match
**Command:** `grep -c "rowsecurity" docs/deployment.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — per-table RLS confirmation step missing

### Contract for Task 2 — server-only secret posture cited
**Check type:** grep-match
**Command:** `grep -c "src/lib/supabase/server.ts" docs/deployment.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — secret posture not grounded to its single source

### Contract for Task 2 — no placeholders in deployment doc
**Check type:** command-exit
**Command:** `! grep -qE "TODO|FIXME|placeholder" docs/deployment.md`
**Expected:** exit 0 (pattern absent)
**Fail if:** Pattern present

### Contract for Phase — TypeScript compiles
**Check type:** command-exit
**Command:** `npx tsc --noEmit`
**Expected:** exit 0
**Fail if:** Any TypeScript compilation error
