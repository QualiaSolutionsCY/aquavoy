# Deployment Hardening Audit

## Intro — what this document is (and is not)

This document records the **deployment security posture** of Aquavoy as it stands
in the repository, plus the **exact operator steps** the client runs to confirm that
posture against live production. Every code-level claim below carries a `file:line`
citation that an auditor can re-grep.

**This audit did NOT execute any `--linked` Supabase command and did NOT trigger any
deploy.** The local Docker stack is down and production is a remote target; running
`--linked` migration/diff commands or hitting prod cron endpoints is the **client
operator's** job. Those commands appear in the *Live production verification* and
*Cron prod confirmation* sections below as **steps to run**, never as captured results.
Treat the operator sections as a checklist; do not infer their output from this file.

---

## Migrations & RLS

Aquavoy ships 12 migrations in `supabase/migrations/`. Eight of them create a table,
and **every created table enables Row Level Security in the same migration**. The
remaining four (`0005`, `0006`, `0008`, `0012`) are `alter table` migrations that add
columns / constraints to tables created earlier — they create no new table and so add
no new RLS surface.

| Migration | Kind | Table | `create table` | `enable row level security` |
|---|---|---|---|---|
| `0001_onedrive_connections.sql` | create | `public.onedrive_connections` | `0001_onedrive_connections.sql:8` | `0001_onedrive_connections.sql:26` |
| `0002_recipients.sql` | create | `public.recipients` | `0002_recipients.sql:8` | `0002_recipients.sql:24` |
| `0003_mail_accounts.sql` | create | `public.mail_accounts` | `0003_mail_accounts.sql:6` | `0003_mail_accounts.sql:28` |
| `0004_chat_messages.sql` | create | `public.chat_messages` | `0004_chat_messages.sql:6` | `0004_chat_messages.sql:22` |
| `0005_fix_mail_accounts_on_conflict.sql` | alter | (alters `mail_accounts`) | — | — |
| `0006_chat_sessions.sql` | alter | (alters `chat_messages`) | — | — |
| `0007_scheduled_emails.sql` | create | `public.scheduled_emails` | `0007_scheduled_emails.sql:10` | `0007_scheduled_emails.sql:33` |
| `0008_reconcile_mail_accounts_email_unique.sql` | alter | (reconciles `mail_accounts` unique) | — | — |
| `0009_memory_facts.sql` | create | `public.memory_facts` | `0009_memory_facts.sql:15` | `0009_memory_facts.sql:41` |
| `0010_pending_actions.sql` | create | `public.pending_actions` | `0010_pending_actions.sql:15` | `0010_pending_actions.sql:37` |
| `0011_agent_traces.sql` | create | `public.agent_traces` | `0011_agent_traces.sql:15` | `0011_agent_traces.sql:36` |
| `0012_mail_stack.sql` | alter | (alters `mail_accounts`) | — | — |

**Result: 8 tables created, 8 with RLS enabled — no created table lacks RLS.**

Re-runnable evidence command (auditor):

```bash
for f in supabase/migrations/*.sql; do
  echo "=== $f ===";
  grep -niE "create table|enable row level security|alter table" "$f";
done
```

---

## Secret posture

`SUPABASE_SERVICE_ROLE_KEY` is the only RLS-bypassing credential in the app. It is
**confined to server-only code**:

- Declared/validated in the env schema: `src/lib/env.ts:60` —
  `SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, ...)`.
- Consumed only by the service-role client factory: `src/lib/supabase/server.ts:15` —
  `createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, ...)`.

There is **no `src/lib/supabase/client.ts` sibling** — `src/lib/supabase/` contains
only `server.ts`, so there is no browser-side Supabase client that could leak the key.
The key is never prefixed `NEXT_PUBLIC_`, and it appears in **no `"use client"`
component** (the only two files referencing it are the two server files above).

Re-runnable audit grep (an auditor runs this; expect output to list ONLY
`src/lib/supabase/server.ts` and `src/lib/env.ts`):

```bash
# Every file that references the service-role key — must be server-only:
grep -rln "SUPABASE_SERVICE_ROLE_KEY" src/

# Confirm no client.ts sibling exists:
ls src/lib/supabase/

# Confirm the key is in no "use client" file:
grep -rl '"use client"' src/ | xargs grep -l "SUPABASE_SERVICE_ROLE_KEY" || echo "CLEAN: not in any client component"
```

---

## Cron configuration

Two Vercel crons are declared in `vercel.json`:

| Path | Schedule | Meaning |
|---|---|---|
| `/api/mail/scheduled/run` | `* * * * *` | every minute — send due scheduled emails (`vercel.json:4-5`) |
| `/api/memory/sweep` | `*/5 * * * *` | every 5 minutes — extract memory facts from closed sessions (`vercel.json:8-9`) |

Both endpoints enforce the **same `CRON_SECRET` bearer-token guard** and reject any
request whose `Authorization` header is not `Bearer ${CRON_SECRET}` (or when the secret
is unset) with HTTP 401:

- Mail cron guard: `src/app/api/mail/scheduled/run/route.ts:18` —
  `if (!cronSecret || authHeader !== ` ``Bearer ${cronSecret}`` `) { return fail("Unauthorized", 401); }`
- Memory sweep guard: `src/app/api/memory/sweep/route.ts:35` —
  `if (!cronSecret || authHeader !== ` ``Bearer ${cronSecret}`` `) { return fail("Unauthorized", 401); }`

`CRON_SECRET` is a server-only env var (documented in `docs/env-reference.md`); Vercel
injects it into the cron invocation headers automatically when set in project env.

---

## Live production verification (operator runs)

The **client operator** runs these against the linked production project. They are
listed here as steps; this audit did NOT execute them. Run from the repo root with the
Supabase CLI authenticated and the project linked.

**Step 1 — All 12 migrations applied, none untracked or missing:**

```bash
npx supabase migration list --linked
```

Expect: every local migration `0001 … 0012` shows applied on Remote, with **no
local-only (untracked) and no remote-only (missing) rows**. A mismatch means drift.

**Step 2 — No schema drift between migrations and live DB:**

```bash
npx supabase db diff --linked
```

Expect: **empty output / "No schema changes found"**. Any emitted SQL means the live
schema diverges from the committed migrations and must be reconciled before sign-off.

**Step 3 — RLS enabled on every public table (run in the Supabase SQL editor or psql):**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```

Expect: **`rowsecurity = true` for every returned row** — specifically for
`onedrive_connections`, `recipients`, `mail_accounts`, `chat_messages`,
`scheduled_emails`, `memory_facts`, `pending_actions`, and `agent_traces`. Any row with
`rowsecurity = false` is a finding to fix before sign-off.

---

## Cron prod confirmation (operator runs)

Confirm the production cron endpoint authenticates and responds. Either:

**Option A — direct curl** (uses the prod `CRON_SECRET`; substitute the deployed URL):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<prod-url>/api/mail/scheduled/run
```

Expect: `200`. Re-run **without** the header (or with a wrong token) and expect `401`
to confirm the guard rejects unauthenticated callers.

**Option B — Vercel Cron logs:** open Vercel → Project → Crons and confirm
`/api/mail/scheduled/run` (every minute) and `/api/memory/sweep` (every 5 minutes) show
recent successful (2xx) invocations.

---

## Monitoring

Uptime and runtime monitoring are documented in **`docs/monitoring.md`**. The uptime
monitor targets **`/api/health`** — the liveness route added in M4-P2 (commit
`5aa1cb9`) — which an external monitor (e.g. UptimeRobot) polls for an HTTP 200
heartbeat. See `docs/monitoring.md` for the monitor configuration and alerting setup.
