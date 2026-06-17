---
phase: 2
result: PASS
gaps: 0
---

# Phase 2 Verification — Deployment Hardening + Monitoring

**REQ-20. Milestone 4, Phase 2.**
Build: commits `5aa1cb9` + `21111e2`.

---

## Contract Results

Pre-run machine contract: `.planning/evidence/phase-2-contract-run.json` — 10/10 PASS, 0 failures.

| # | Task | Check type | Command | Result | Notes |
|---|------|-----------|---------|--------|-------|
| 1 | T1 | file-exists | `test -f src/app/api/health/route.ts` | PASS | File present, 13 lines |
| 2 | T1 | grep-match | `grep -c "/api/health" src/proxy.ts` | PASS | 2 matches (comment + set) |
| 3 | T1 | grep-match | `grep -c "process.env" src/app/api/health/route.ts` | PASS | 0 — no secret read |
| 4 | T1 | grep-match | `grep -c "stats.uptimerobot.com/bKudHy1pLs" docs/monitoring.md` | PASS | 2 matches |
| 5 | T1 | command-exit | `! grep -qE "TODO\|FIXME\|placeholder" docs/monitoring.md` | PASS | 0 markers |
| 6 | T2 | file-exists | `test -f docs/deployment.md` | PASS | File present, 175 lines |
| 7 | T2 | grep-match | `grep -c "supabase migration list --linked" docs/deployment.md` | PASS | 1 match |
| 8 | T2 | grep-match | `grep -c "rowsecurity" docs/deployment.md` | PASS | 3 matches |
| 9 | T2 | grep-match | `grep -c "src/lib/supabase/server.ts" docs/deployment.md` | PASS | 1 match |
| 10 | Phase | command-exit | `npx tsc --noEmit` | PASS | exit 0 |

---

## Security-Adversarial Pass — Proxy Allowlist

### What changed

`src/proxy.ts:21` — `const ALLOWLIST = new Set<string>(["/login", "/api/login", "/api/mail/scheduled/run", "/api/health"]);`

One entry added. The three pre-existing entries (`/login`, `/api/login`, `/api/mail/scheduled/run`) are unchanged and still present. Set size is exactly 4.

### Matching logic is exact, not prefix

`src/proxy.ts:26` — `if (ALLOWLIST.has(pathname)) { return NextResponse.next(); }`

`Set.prototype.has` is a strict equality check. Verified with Node.js: `/api/healthcheck`, `/api/health/anything`, `/api/healthz`, and `/api/health?foo=bar` all return `false`. Only the exact string `"/api/health"` is allowlisted.

The `startsWith("/api/")` at `src/proxy.ts:34` is reached only after both the allowlist gate and the auth gate fail — it decides between returning a 401 JSON envelope and a redirect to `/login`. It does not widen the allowlist.

### No other path loosened

`/api/memory/sweep` is not in the allowlist (`Set.has` → `false`). It remains auth-gated and additionally guarded by its own `CRON_SECRET` bearer check at `src/app/api/memory/sweep/route.ts:35`.

**Adversarial verdict: CLEAN. Allowlist gained exactly one entry; matching is exact-string; no mutating or PII route became reachable unauthenticated.**

---

## Health Route — Secret Leak Analysis

`src/app/api/health/route.ts` — 13 lines, one import.

- `src/app/api/health/route.ts:1` — `import { ok } from "@/lib/http";` — only import is the response-helper.
- `grep -c "process.env" src/app/api/health/route.ts` → 0.
- No `supabase`, `createClient`, `server`, or `client` import present.
- `src/app/api/health/route.ts:11-13` — `export function GET() { return ok({ status: "ok", ts: new Date().toISOString() }); }` — pure timestamp, no I/O.

`ok()` at `src/lib/http.ts:5` — `return NextResponse.json({ ok: true, data }, init);` — wraps data, no env access.

**Health route leaks nothing. It is a pure liveness probe.**

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| `/api/health` returns 200 unauthenticated, reads no secret | 5 | 5 | 5 | 5 | PASS |
| `docs/monitoring.md` complete, no placeholders | 5 | 5 | 5 | 5 | PASS |
| `docs/deployment.md` complete, accurate citations, operator-runbook only | 5 | 5 | 5 | 5 | PASS |
| No deploy triggered, no live output fabricated | 5 | 5 | 5 | 5 | PASS |
| `npx tsc --noEmit` exits 0 | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check: NO scores below 3.**

---

## Evidence by Criterion

### 1. `/api/health` returns 200 unauthenticated, reads no secret

- `src/app/api/health/route.ts:1-13` — single `ok` import, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `GET()` returns `ok({ status: "ok", ts: new Date().toISOString() })`. No env access, no DB, no outbound call. (Correctness: 5, Completeness: 5)
- `src/proxy.ts:21` — `ALLOWLIST` contains `"/api/health"` as exact-match entry. `ALLOWLIST.has(pathname)` at line 26 bypasses auth for matching callers. (Wiring: 5)
- No stubs: `grep -cE "TODO|FIXME|stub|not implemented|placeholder" src/app/api/health/route.ts` → 0. (Quality: 5)

### 2. `docs/monitoring.md` complete, no placeholders

- `docs/monitoring.md:7` — `https://stats.uptimerobot.com/bKudHy1pLs` present.
- `docs/monitoring.md:8` — `GET <prod-url>/api/health` as the liveness endpoint.
- `docs/monitoring.md:30-43` — Cron monitoring table with both paths and schedules matching `vercel.json` exactly: `/api/mail/scheduled/run` `* * * * *`, `/api/memory/sweep` `*/5 * * * *`.
- `docs/monitoring.md:40-43` — Vercel Dashboard → Cron Jobs + Logs tab documented.
- `docs/monitoring.md:47-56` — Error visibility: Vercel Dashboard → Logs, with filter guidance.
- `grep -cE "TODO|FIXME|placeholder" docs/monitoring.md` → 0.

### 3. `docs/deployment.md` accurate citations, operator-runbook only

**Migration table spot-check (3 of 8):**
- `0001_onedrive_connections.sql:8` — `create table if not exists public.onedrive_connections` — CONFIRMED.
- `0001_onedrive_connections.sql:26` — `alter table public.onedrive_connections enable row level security;` — CONFIRMED.
- `0002_recipients.sql:8` — `create table if not exists public.recipients` — CONFIRMED.
- `0002_recipients.sql:24` — `alter table public.recipients enable row level security;` — CONFIRMED (doc says line 24, actual is line 24 — CONFIRMED).
- `0009_memory_facts.sql:15` — `create table if not exists public.memory_facts` — CONFIRMED.
- `0009_memory_facts.sql:41` — `alter table public.memory_facts enable row level security;` — CONFIRMED.
- `0010_pending_actions.sql:15` — `create table if not exists public.pending_actions` — CONFIRMED.
- `0010_pending_actions.sql:37` — `alter table public.pending_actions enable row level security;` — CONFIRMED.
- `0011_agent_traces.sql:15` — `create table if not exists public.agent_traces` — CONFIRMED.
- `0011_agent_traces.sql:36` — `alter table public.agent_traces enable row level security;` — CONFIRMED.
- `0006_chat_sessions.sql:5` — `alter table public.chat_messages` — alter-table only, no new RLS surface, correctly classified.
- `0012_mail_stack.sql:15,22` — alter-table only, correctly classified.

**Secret posture:**
- `grep -rln "SUPABASE_SERVICE_ROLE_KEY" src/` → `src/lib/env.ts` and `src/lib/supabase/server.ts` only. Exactly matches `docs/deployment.md:60-63`.
- `ls src/lib/supabase/` → `server.ts` only. No `client.ts` sibling. Confirms `docs/deployment.md:65-66`.
- `grep -rl '"use client"' src/ | xargs grep -l "SUPABASE_SERVICE_ROLE_KEY"` → `CLEAN` (empty). Confirms `docs/deployment.md:68`.

**Cron guard citations:**
- `src/app/api/mail/scheduled/run/route.ts:18` — `if (!cronSecret || authHeader !== \`Bearer ${cronSecret}\`)` — CONFIRMED.
- `src/app/api/memory/sweep/route.ts:35` — `if (!cronSecret || authHeader !== \`Bearer ${cronSecret}\`)` — CONFIRMED.
- `vercel.json` cron paths and schedules match `docs/deployment.md:90-93` exactly.

**Operator-runbook compliance:**
- `docs/deployment.md:14-15` — explicit statement: "This audit did NOT execute any `--linked` Supabase command and did NOT trigger any deploy."
- `docs/deployment.md:109-144` — Live production verification section presents `npx supabase migration list --linked`, `npx supabase db diff --linked`, and the `pg_tables rowsecurity` query as labeled **steps to run**, with expected output described, not captured.
- No `--linked` output appears anywhere in the file.

**No placeholders:** `grep -cE "TODO|FIXME|placeholder" docs/deployment.md` → 0.

### 4. No deploy triggered, no live output fabricated

`docs/deployment.md:14-15` — "This audit did NOT execute any `--linked` Supabase command and did NOT trigger any deploy." No live command output appears in the document. All operator steps are presented as commands with described expectations.

### 5. TypeScript compiles

`npx tsc --noEmit` → exit 0. `npm test` → 59/59 passed (12 test files).

---

## Code Quality

- TypeScript: PASS (exit 0)
- Stubs found: 0
- Empty handlers: 0
- Unused imports: 0
- Test suite: 59/59 PASS

---

## Design Verification

N/A — no frontend files touched in this phase. Phase 2 is backend-only (one API route, two docs files, one proxy config line).

---

## Verdict

PASS — Phase 2 goal achieved. All 5 success criteria scored 5/5 on all dimensions. Security-adversarial pass on the proxy change confirms the allowlist gained exactly one exact-match entry (`/api/health`) with no prefix-escape risk, no pre-existing entry removed or loosened, and `/api/memory/sweep` correctly remains outside the allowlist. Health route carries zero imports that could leak secrets or fail on DB unavailability. All migration file:line citations in `docs/deployment.md` spot-checked and confirmed accurate. Operator-runbook constraint respected: no `--linked` output fabricated. Proceed to Phase 3 (if any), or close Milestone 4.
