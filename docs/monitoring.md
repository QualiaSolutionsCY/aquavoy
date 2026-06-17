# Monitoring

How Aquavoy is monitored in production: liveness, scheduled jobs, and runtime errors.

## Uptime monitoring

- **Status page:** https://stats.uptimerobot.com/bKudHy1pLs
- **Liveness endpoint:** `GET <prod-url>/api/health`

`/api/health` is a pure liveness probe. It returns HTTP 200 with a JSON body
of the form `{"ok":true,"data":{"status":"ok","ts":"<ISO-8601 timestamp>"}}`.
It reads no environment secret, touches no database, and makes no outbound
network call — so a 200 means the Next.js runtime is up and serving, nothing
more. It is allowlisted in the auth proxy (`src/proxy.ts`), so monitors reach
it without credentials.

### Add the UptimeRobot HTTP monitor

1. Log in to UptimeRobot and create a new monitor.
2. **Monitor Type:** HTTP(s).
3. **URL:** `<prod-url>/api/health` (substitute the deployed Vercel production URL).
4. **Monitoring interval:** 5 minutes (or tighter if the plan allows).
5. Under advanced settings, set the expected status code to **200** — any
   non-200 (or a timeout) trips the monitor and pages the on-call contact.
6. Attach the monitor to the public status page above so the client can see
   live up/down state at https://stats.uptimerobot.com/bKudHy1pLs.

## Cron monitoring

Two Vercel cron jobs run in production, defined in `vercel.json`:

| Path                       | Schedule        | Frequency        |
| -------------------------- | --------------- | ---------------- |
| `/api/mail/scheduled/run`  | `* * * * *`     | Every minute     |
| `/api/memory/sweep`        | `*/5 * * * *`   | Every 5 minutes  |

`/api/mail/scheduled/run` is the scheduled-email runner; `/api/memory/sweep`
prunes expired memory state. Both are invoked by Vercel's cron scheduler.

**Where Vercel shows cron execution:** Vercel Dashboard → the Aquavoy project →
**Cron Jobs** tab lists each cron, its schedule, and last-run status. Click a
cron, or open the **Logs** tab and filter by the cron path, to see per-invocation
execution logs (start time, duration, status code, and any thrown errors).

## Error visibility

For function and runtime errors (failed requests, unhandled exceptions, 500s):

- **Vercel Dashboard → the Aquavoy project → Logs.** This surfaces runtime and
  function logs across all routes. Filter by route path, status code, or time
  range to isolate a failing endpoint.
- For cron-specific failures, cross-reference **Dashboard → Cron Jobs** (per-cron
  last-run status) with the filtered **Logs** view for that cron's path.

A red status on the UptimeRobot status page combined with 5xx entries in the
Vercel Logs view is the standard signal that production is degraded.
