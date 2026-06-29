---
phase: 6
goal: "Tell Wency when a proposal/action stages for confirmation, via web-push (PWA Service Worker) as the MVP channel behind a vendor-agnostic adapter seam, with preferences + quiet hours; triggers are fire-and-forget (never break stagePendingAction); WhatsApp deferred (ADR-008)."
tasks: 4
waves: 3
---

# Phase 6: Notifications

**Goal:** When any destructive action stages for confirmation (`stagePendingAction`), the signed-in operator gets a web-push notification on their installed PWA — subject to per-event opt-in and quiet hours — and every send attempt is logged for a 90-day audit. The notify layer is a vendor-agnostic adapter so WhatsApp (Telnyx) drops in later without rework. Delivery is fire-and-forget: a notification failure NEVER throws or fails the underlying staging insert.

**Why this phase:** Wency's meeting ask was "tell me like a WhatsApp when an invoice is ready" (ADR-008 §Context). Web-push delivers that value immediately with zero vendor onboarding, riding the Phase-1 PWA manifest. The adapter seam means the WhatsApp follow-on is one file, not a refactor.

> **Migration numbering (coordinate with Phase 5):** `0016_invoice_templates.sql` and `0017_voyage_entries.sql` exist on disk (`ls supabase/migrations/`). Phase 5 (planned in parallel) takes `0018_processed_messages.sql`. **This phase uses `0019`.** If you build after P5 ships and `0018` is taken, keep `0019`; if `0019` is also taken, use the next free number and note it in the deviations log.
>
> **Shared file with Phase 5:** `src/lib/agents/pendingActions.ts`. Task 3 adds ONE fire-and-forget call inside `stagePendingAction` (after the row inserts, before the return). P5 is not expected to touch this function, but if a merge conflict arises, the notify hook is additive — re-apply it after the insert.
>
> **NEW dependency:** `web-push` (npm). Task 2 installs it. API confirmed against the upstream README (web-push-libs/web-push): `setVapidDetails(subject, publicKey, privateKey)`, `sendNotification(pushSubscription, payload, options) → Promise<Response>` (rejects with a `WebPushError` carrying `statusCode`; `410`/`404` = expired subscription), `generateVAPIDKeys() → { publicKey, privateKey }`. The `PushSubscription` shape is `{ endpoint: string, keys: { p256dh: string, auth: string } }`.

---

## Task 1 — Migration: notification_preferences + notification_log (0019)
**Wave:** 1
**Persona:** backend
**Files:**
- `supabase/migrations/0019_notifications.sql` (new)
**Depends on:** none

**Why:** The trigger, the preferences API, and the audit log all read/write these two tables; nothing in this phase functions until the schema exists. Storing the push subscription, per-event opt-in, and quiet-hours window per principal is what lets the trigger decide whether and where to send.

**Acceptance Criteria:**
- A `notification_preferences` table exists keyed by `principal` (one row per operator) with: `channel`, `enabled_events` (jsonb array of event keys), `quiet_hours_start`/`quiet_hours_end` (nullable `time`), `push_subscription` (nullable jsonb), `created_at`, `updated_at`.
- A `notification_log` table exists with: `id`, `principal`, `channel`, `event`, `sent_at`, `error` (nullable text), `metadata` (jsonb).
- Both tables have `principal text not null check (principal in ('Wency','Jeanette'))` — matching `0010_pending_actions.sql:17`.
- Both tables have RLS **enabled with NO policies** (service-role-only), matching the project's established pattern (`0010_pending_actions.sql:36-37` — "RLS on, no policies → inaccessible to anon/authenticated roles").
- `notification_preferences.principal` is `unique` (one preferences row per operator).
- An index on `notification_log (principal, sent_at)` for recency-ordered audit reads.

**Action:**
- Mirror the header-comment + structure of `supabase/migrations/0010_pending_actions.sql`.
- **RLS justification (state this in a SQL comment):** This project has NO Supabase Auth — the principal is carried in a signed HMAC cookie (`src/lib/auth/session.ts`), not `auth.uid()`. A principal-scoped RLS *policy* is therefore impossible (there is no DB-level identity to match). Following the project-wide pattern (every table from `0004_chat_messages.sql` through `0017`), these tables are **service-role-only: `alter table … enable row level security;` with NO `create policy`**, and the `principal` CHECK enforces the valid-operator set at the schema level. The preferences API route (Task 3) scopes every query to the session principal via `supabaseAdmin()` + `.eq("principal", principal)`, exactly like `/api/actions/route.ts:21`.
- `enabled_events` default: `'["stage"]'::jsonb` (stage notifications on by default; scheduled-task-fire is opt-in per ADR-008 §1).
- `quiet_hours_start`/`quiet_hours_end` nullable `time` — null means "no quiet hours". The wrap-midnight logic (start > end) lives in code (Task 3), not the schema.
- For the 90-day audit: do NOT add a DB cron; add a SQL comment noting the log is read with a `sent_at >= now() - interval '90 days'` filter at query time (matches the project's no-DB-cron convention).

**Validation:** (builder self-check)
- `grep -c "enable row level security" supabase/migrations/0019_notifications.sql` → `2` (both tables)
- `grep -c "create policy" supabase/migrations/0019_notifications.sql` → `0` (service-role-only)
- `grep -E "principal.*check.*Wency.*Jeanette" supabase/migrations/0019_notifications.sql` → matches on both tables
- `grep "push_subscription" supabase/migrations/0019_notifications.sql` → present (jsonb column)

**Context:** Read @supabase/migrations/0010_pending_actions.sql @.planning/decisions/ADR-008-notification-channel.md @src/app/api/actions/route.ts

---

## Task 2 — Adapter seam + web-push channel + Service Worker
**Wave:** 1
**Persona:** backend
**Files:**
- `src/lib/notify/adapter.ts` (new) — `NotificationChannel` interface + `dispatch()` + the `NotifyMessage` type
- `src/lib/notify/webpush.ts` (new) — web-push impl of `NotificationChannel`
- `src/lib/notify/webpush.test.ts` (new) — adapter contract + fire-safe error handling
- `src/lib/env.ts` (modify) — add an optional `getVapidEnv()` schema (VAPID keys optional so the app boots without them)
- `public/sw.js` (new) — Service Worker: `push` + `notificationclick` handlers
- `package.json` (modify) — add `web-push` dependency
**Depends on:** none

**Why:** The adapter is the seam ADR-008 §2 mandates — WhatsApp/Telnyx and an email-digest fallback implement the same `NotificationChannel` interface later, so adding them is one file, not a refactor. The web-push impl is the MVP channel; the Service Worker is what actually surfaces the OS notification on the installed PWA. ADR-008 also defers WhatsApp/Telnyx to a later phase — this task lays ONLY the seam, never a WhatsApp impl or Telnyx wiring.

**Acceptance Criteria:**
- `src/lib/notify/adapter.ts` exports a `NotificationChannel` interface with `name: string` and `send(principal: Principal, message: NotifyMessage, subscription: PushSubscriptionJSON): Promise<{ ok: boolean; expired?: boolean; error?: string }>`, plus a `NotifyMessage` type (`{ title: string; body: string; url?: string }`).
- `src/lib/notify/webpush.ts` exports `webPushChannel: NotificationChannel` whose `send()` calls `webpush.setVapidDetails(...)` once + `webpush.sendNotification(...)`, and **never throws** — it catches, maps `WebPushError.statusCode` 410/404 → `{ ok: false, expired: true }`, any other error → `{ ok: false, error }`.
- If VAPID keys are absent from env, `webPushChannel.send()` returns `{ ok: false, error: "web-push not configured" }` without throwing (app boots without keys).
- `public/sw.js` has a `push` event listener that calls `self.registration.showNotification(title, { body, data: { url } })` and a `notificationclick` listener that focuses/opens the `url`.
- `web-push` appears in `package.json` dependencies.
- WhatsApp/Telnyx is NOT built: no `src/lib/notify/whatsapp.ts` file is created and no `TELNYX`/`whatsapp` reference appears anywhere under `src/lib/notify/` (ADR-008 defers it; only the adapter seam is ready).

**Action:**
- Install: `npm install web-push` and `npm install -D @types/web-push`.
- `adapter.ts`: import `Principal` from `@/lib/openrouter/client`. Define `NotifyMessage`, `NotificationChannel`. Do NOT put any web-push specifics here — this file is vendor-agnostic (that is the seam). It may export a `dispatch(channel, principal, message, subscription)` helper that just calls `channel.send(...)` and returns the result (keeps the trigger thin).
- `webpush.ts`: `import webpush from "web-push"`. Add `getVapidEnv()` to `src/lib/env.ts` following the existing `getTavilyEnv()` pattern (a cached Zod schema), but make all three fields **optional** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` defaulting to `mailto:dev@aquavoy.com`) so a missing key does not crash the schema — read them with a try/catch returning `null` when unset. `send()` guards on keys present, calls `setVapidDetails` + `sendNotification(subscription, JSON.stringify(message))`, wraps everything in try/catch. **The web-push impl must import the `NotificationChannel` type from the adapter seam and implement it (`webPushChannel: NotificationChannel`) — the seam is the contract, not a parallel shape.**
- `sw.js`: plain JS (not bundled). `self.addEventListener('push', (e) => { const d = e.data?.json() ?? {}; e.waitUntil(self.registration.showNotification(d.title ?? 'Aquavoy', { body: d.body ?? '', data: { url: d.url ?? '/' }, icon: '/icon-192.png' })); })`. `notificationclick`: `e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data?.url ?? '/'));`.
- **Do NOT create `whatsapp.ts` or add any Telnyx/WhatsApp code** — ADR-008 defers that channel to a later phase. The seam is the only deliverable for the second channel.
- `webpush.test.ts`: mock the `web-push` module; assert (a) a 410 rejection maps to `{ ok: false, expired: true }`, (b) a generic rejection maps to `{ ok: false, error }` and does NOT throw, (c) missing VAPID keys → `{ ok: false }` without calling `sendNotification`.

**Validation:** (builder self-check)
- `grep -c "web-push" package.json` → `≥ 1`
- `grep -E "export (interface|type) NotificationChannel" src/lib/notify/adapter.ts` → present
- `grep -c "adapter" src/lib/notify/webpush.ts` → `≥ 1` (imports the `NotificationChannel` seam)
- `grep "showNotification" public/sw.js` → present
- `grep "notificationclick" public/sw.js` → present
- `test ! -f src/lib/notify/whatsapp.ts && echo NO_WHATSAPP` → `NO_WHATSAPP` (deferred)
- `grep -rci "telnyx\|whatsapp" src/lib/notify` → `0` (no deferred-channel wiring)
- `npx vitest run src/lib/notify/webpush.test.ts` → all pass
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @.planning/decisions/ADR-008-notification-channel.md @src/lib/env.ts @src/lib/openrouter/client.ts (for the `Principal` type + `PRINCIPALS`)

---

## Task 3 — Fire-and-forget trigger + preferences lib + API routes (subscribe + preferences)
**Wave:** 2
**Persona:** backend
**Files:**
- `src/lib/notify/triggers.ts` (new) — `notifyOnStage(principal, action)`
- `src/lib/notify/preferences.ts` (new) — read/write `notification_preferences` (loadPreferences, savePreferences, clearExpiredSubscription) + `isWithinQuietHours()`
- `src/lib/notify/triggers.test.ts` (new) — proves the trigger is fire-and-forget (a send/DB failure never throws) + quiet-hours + event opt-in gating
- `src/lib/agents/pendingActions.ts` (modify) — call `notifyOnStage` after the insert, before the return (fire-and-forget)
- `src/app/api/notify/subscribe/route.ts` (new) — `POST` to register/replace the principal's push subscription
- `src/app/api/notify/preferences/route.ts` (new) — `GET` current prefs + `POST` to update opt-in/quiet-hours
- `src/app/api/notify/preferences/route.test.ts` (new) — principal-scoping + 401 without session
**Depends on:** Task 1, Task 2

**Why:** This is the behavioral core — the moment an action stages, the operator learns about it. ADR-008 §2 and the learned-pattern are explicit: a delivery failure must NEVER fail the `stagePendingAction` insert (that insert is the ADR-003 confirm-gate; breaking it would silently drop destructive-action staging). So the hook is wrapped in fire-and-forget and the trigger swallows every error into `notification_log`. The trigger, the preferences helper, and the two `/api/notify/*` routes are one subsystem (`src/lib/notify/` + `src/app/api/notify/`): the routes go through the same `preferences.ts` helper the trigger uses, so principal-scoping lives in exactly one place — they belong in one task.

**Acceptance Criteria:**
- `notifyOnStage(principal, action)` loads the principal's preferences; if no `push_subscription`, or `"stage"` not in `enabled_events`, or the current time is within quiet hours, it logs a skipped/suppressed row (or simply returns) and sends nothing.
- When it does send, it builds a `NotifyMessage` from `action.summary` (title `"Action ready to confirm"`, body = `action.summary`, url `"/"`), calls `webPushChannel.send(...)`, and writes a `notification_log` row with the outcome (error column populated on failure). On a `410`/`404` (expired) result, it clears `push_subscription` for that principal so the dead subscription is not retried.
- `stagePendingAction` calls `notifyOnStage(...)` AFTER the row inserts successfully, in a way that CANNOT throw into the insert path — `void notifyOnStage(...).catch(() => {})` (fire-and-forget), and the function still returns the staged `PendingAction` exactly as before. `isWithinQuietHours(now, start, end)` correctly handles the wrap-midnight case (e.g. start `22:00`, end `07:00` → `23:30` and `06:00` are both quiet; `12:00` is not). `triggers.ts` does NOT import from `pendingActions.ts` (no cycle).
- `POST /api/notify/subscribe` reads the principal via `getPrincipal(req)` (401 if absent), validates the body as a `PushSubscriptionJSON` with Zod (`endpoint` url, `keys.p256dh` string, `keys.auth` string), and saves it to `notification_preferences.push_subscription` for that principal (upsert) **via the `savePreferences` helper**, returning `{ ok: true }`.
- `GET /api/notify/preferences` returns the principal's prefs **via `loadPreferences`** (creating a default row if none exists: `enabled_events: ["stage"]`, no quiet hours, channel `webpush`). `POST /api/notify/preferences` validates a body of `{ enabled_events?: string[]; quiet_hours_start?: string|null; quiet_hours_end?: string|null }` with Zod (times as `HH:MM` or null), updates only the provided fields **via `savePreferences`**, and returns the updated prefs — the push subscription is NOT settable here (that is the subscribe route).
- All three handlers 401 without a verified session principal; both route files set `runtime = "nodejs"` and `dynamic = "force-dynamic"` (matches `/api/actions/route.ts:5-6`); neither route is added to the `src/proxy.ts` cron allowlist (auth-gated by default).

**Action:**
- `preferences.ts`: `loadPreferences(principal)` → `supabaseAdmin().from("notification_preferences").select(...).eq("principal", principal).maybeSingle()`. `savePreferences(principal, patch)` → upsert on `principal`. `clearExpiredSubscription(principal)` → update `push_subscription = null`. `isWithinQuietHours(now: Date, start: string|null, end: string|null): boolean` — null start/end → `false`; compute minutes-of-day; if `start <= end` it's the simple range, else (wrap) it's `mins >= start || mins < end`.
- `triggers.ts`: `notifyOnStage(principal: Principal, action: { summary: string }): Promise<void>`. Load prefs → gate on subscription present + `"stage"` opt-in + not quiet hours → `webPushChannel.send(...)` → log to `notification_log` → on `expired`, `clearExpiredSubscription`. Wrap the ENTIRE body in try/catch; on any throw, best-effort log to `notification_log` with the error and return (never re-throw).
- `pendingActions.ts`: import `notifyOnStage` from `@/lib/notify/triggers`. In `stagePendingAction`, after `if (error) throw …; ` and the `toPendingAction(data)` line, capture the action, then `void notifyOnStage(action.principal as Principal, { summary: action.summary }).catch(() => {});` and return the action. (Place it so the return value is unchanged.) **Watch the import direction:** `triggers.ts` must NOT import from `pendingActions.ts` (no cycle) — it only takes the `{ principal, summary }` it needs.
- Both route files: model on `src/app/api/actions/route.ts`: `getPrincipal(req)` → 401 envelope `{ ok: false, error: "Unauthorized" }`. Use the `loadPreferences`/`savePreferences` helpers from `preferences.ts` (do NOT re-query Supabase inline — go through the helper so the principal scoping lives in one place). Zod-validate every request body (`rules/security.md`: "Validate with Zod"); reject malformed bodies with a `400`. These routes are NOT cron paths, so they require auth by default in `src/proxy.ts` — the allowlist is only login/cron/health (`src/proxy.ts:32-36`); do NOT add them to the allowlist.
- `triggers.test.ts`: mock `@/lib/notify/preferences`, `@/lib/notify/webpush`, and `supabaseAdmin`. Assert: (a) when `webPushChannel.send` rejects/throws, `notifyOnStage` resolves (does not throw); (b) `"stage"` not in `enabled_events` → `send` NOT called; (c) within quiet hours → `send` NOT called; (d) `expired: true` result → `clearExpiredSubscription` called. Add a focused unit test for `isWithinQuietHours` wrap-midnight.
- `preferences/route.test.ts`: mock `getPrincipal` + the `preferences.ts` helpers. Assert (a) no principal → 401, (b) `GET` returns the loaded prefs scoped to the session principal, (c) `POST` with a body that names a *different* principal still writes for the SESSION principal (the body principal, if any, is ignored).

**Validation:** (builder self-check)
- `grep -n "notifyOnStage" src/lib/agents/pendingActions.ts` → import + one call site
- `grep "void notifyOnStage" src/lib/agents/pendingActions.ts` → present (fire-and-forget form)
- `grep -c "import.*pendingActions" src/lib/notify/triggers.ts` → `0` (no cycle)
- `grep "getPrincipal" src/app/api/notify/subscribe/route.ts src/app/api/notify/preferences/route.ts` → present in both
- `grep -c "loadPreferences\|savePreferences" src/app/api/notify/preferences/route.ts` → `≥ 1` (route uses the preferences lib)
- `grep -E "z\.(object|string)" src/app/api/notify/subscribe/route.ts` → Zod validation present
- `grep -c "notify" src/proxy.ts` → `0` (NOT added to the cron allowlist)
- `npx vitest run src/lib/notify/triggers.test.ts src/lib/agents/pendingActions.test.ts src/app/api/notify/preferences/route.test.ts` → all pass (the existing pendingActions lifecycle tests still pass — the hook must not break them; mock `@/lib/notify/triggers` in that test if needed)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/agents/pendingActions.ts @src/lib/agents/pendingActions.test.ts @src/app/api/actions/route.ts @src/lib/auth/session.ts @src/proxy.ts @.planning/decisions/ADR-008-notification-channel.md @.planning/decisions/ADR-003-enforced-confirm-undo.md

---

## Task 4 — Settings UI: enable push + preferences + quiet hours
**Wave:** 3
**Persona:** frontend
**Files:**
- `src/app/settings/page.tsx` (new) — a settings section: "Enable notifications" button (registers SW + subscribes) + event opt-in toggles + quiet-hours time inputs
- `src/components/Nav.tsx` (modify) — add a `/settings` link
**Depends on:** Task 2, Task 3

**Why:** Web-push requires an explicit user gesture to register the Service Worker and request the OS notification permission — there is no server-side way to do this. This surface is also where the operator toggles which events notify and sets quiet hours. Without it, no subscription is ever stored and the trigger has nothing to send to.

**Acceptance Criteria:**
- A `/settings` page renders under the existing app shell with the maritime dark-ocean design tokens (matches the Emails/Finance/Tasks pages).
- An "Enable notifications" control: on click, registers `/sw.js`, calls `Notification.requestPermission()`, then `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key> })`, and `POST`s the resulting subscription JSON to `/api/notify/subscribe`. The VAPID public key is read from `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- If the browser lacks push support (no `serviceWorker`/`PushManager`) OR permission is denied, the UI shows a clear message — and an explicit note that **iOS requires the app be installed to the Home Screen first** (ADR-008 §Consequences: iOS 16.4+ installed PWA only).
- Event opt-in toggles (at minimum a "stage" toggle for "When an action is ready to confirm") and quiet-hours start/end time inputs, loaded from `GET /api/notify/preferences` and saved via `POST /api/notify/preferences`.
- Loading, error, and empty/permission states are all handled (per the design rubric — no bare states).
- A `/settings` link appears in `Nav.tsx`.

**Action:**
- `"use client"`. Follow the structure + token usage of `src/app/tasks/page.tsx` (fetch on mount, loading/error/empty states, lucide icons). Use a `Bell`/`BellRing` icon.
- The enable flow must be inside a click handler (user gesture) — guard `typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window`.
- Convert the VAPID public key from base64url to a `Uint8Array` for `applicationServerKey` (standard urlBase64ToUint8Array helper — include it inline).
- Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the env note (it MUST be `NEXT_PUBLIC_` — it is the public key, safe in the bundle; the PRIVATE key from Task 2 stays server-only).
- `Nav.tsx`: add a `/settings` entry to the `LINKS` array (`{ href: "/settings", label: "Settings" }`) mirroring the existing entry shape (`src/components/Nav.tsx:8-14`).

**Design:** (REQUIRED — touches .tsx)
- Register: product
- Tokens used: `var(--bg)`, `var(--surface)`, `var(--border)`, `var(--text)`, `var(--text-dim)`, `var(--accent)`, `var(--accent-subtle)`, `--sp-3`, `--sp-4`, `--sp-5`, `--radius`, `--radius-lg`, `var(--font-sans)`, `var(--font-mono)` — the exact custom properties defined in `src/app/globals.css:6-44`. Reuse the shared `.wrap`/`.head`/`.tag`/`.btn`/`.notice`/`.empty`/`.panel` classes (`globals.css:413-439, 442-512, 628-673, 1899-1913`) rather than new CSS where possible. Do NOT hardcode hex/oklch.
- Scope: page
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/app/settings/page.tsx` pre-commit if the script exists; otherwise self-check against the 6-dimension design rubric (Typography, Color, Spacing, States, Responsiveness, Accessibility) — every interactive control needs a focus state and a 44px+ touch target; works at 375px and 1440px.

**Validation:** (builder self-check)
- `grep "pushManager.subscribe" src/app/settings/page.tsx` → present
- `grep "/api/notify/subscribe" src/app/settings/page.tsx` → present
- `grep "Home Screen\|installed\|iOS" src/app/settings/page.tsx` → iOS install caveat present
- `grep "/settings" src/components/Nav.tsx` → link added
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `npm run build 2>&1 | grep -c "Failed to compile\|error"` → `0`

**Context:** Read @src/app/tasks/page.tsx @src/components/Nav.tsx @src/app/globals.css @.planning/decisions/ADR-008-notification-channel.md

---

## Success Criteria
- [ ] When a destructive action stages (`stagePendingAction`), the signed-in operator with a registered subscription and a `"stage"` opt-in gets an OS web-push notification on their installed PWA — outside quiet hours.
- [ ] A notification delivery failure (network, expired subscription, missing VAPID keys) NEVER throws or fails the `stagePendingAction` insert — it is logged to `notification_log` and swallowed (fire-and-forget verified by a test).
- [ ] The notify layer is a vendor-agnostic `NotificationChannel` adapter (`src/lib/notify/adapter.ts`); web-push is one implementation; adding WhatsApp later is one new file implementing the same interface (no change to triggers/routes).
- [ ] `notification_preferences` + `notification_log` exist (migration `0019`), RLS-on / service-role-only, principal-CHECK-constrained, every query scoped to the session principal.
- [ ] The operator can enable push (user gesture → SW registration → permission → subscribe), toggle the stage event, and set wrap-midnight quiet hours from `/settings`; the iOS "install first" caveat is shown.
- [ ] WhatsApp/Telnyx is NOT built (deferred per ADR-008); only the adapter seam is left ready. No Telnyx env, no `whatsapp.ts`. **Owned by Task 2** — asserted by its `test ! -f src/lib/notify/whatsapp.ts` + `grep -rci "telnyx|whatsapp" src/lib/notify → 0` validations and the whole-phase "WhatsApp NOT built" contract below.
- [ ] `npx tsc --noEmit` exits 0; all new tests pass. **Cross-cutting** — enforced by every task's Validation block (each runs `npx tsc --noEmit … grep -c "error TS" → 0` and its own `npx vitest run …`) and by the whole-phase "compiles + builds" Verification Contract below.

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0019_notifications.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — RLS on, no policies (service-role-only)
**Check type:** command-exit
**Command:** `bash -c 'echo "rls=$(grep -c "enable row level security" supabase/migrations/0019_notifications.sql) pol=$(grep -c "create policy" supabase/migrations/0019_notifications.sql)"'`
**Expected:** `rls=2 pol=0`
**Fail if:** Fewer than 2 RLS-enable statements, or any `create policy` (the project pattern is service-role-only)

### Contract for Task 1 — principal CHECK + push_subscription column
**Check type:** grep-match
**Command:** `grep -E "principal in \('Wency', ?'Jeanette'\)" supabase/migrations/0019_notifications.sql; grep -c "push_subscription" supabase/migrations/0019_notifications.sql`
**Expected:** principal CHECK present on both tables; `push_subscription` count ≥ 1
**Fail if:** Missing principal CHECK or missing push_subscription jsonb column

### Contract for Task 2 — adapter seam interface exists
**Check type:** grep-match
**Command:** `grep -Ec "(interface|type) NotificationChannel" src/lib/notify/adapter.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** `NotificationChannel` interface is not defined — there is no vendor-agnostic seam

### Contract for Task 2 — webpush implements the adapter seam (wiring)
**Check type:** grep-match
**Command:** `grep -c "adapter" src/lib/notify/webpush.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — webpush.ts does not import the `NotificationChannel` seam (it built a parallel shape instead of implementing the contract)

### Contract for Task 2 — web-push installed
**Check type:** grep-match
**Command:** `grep -c "\"web-push\"" package.json`
**Expected:** Non-zero (≥ 1)
**Fail if:** `web-push` is not a dependency

### Contract for Task 2 — Service Worker handlers
**Check type:** grep-match
**Command:** `grep -c "showNotification\|notificationclick" public/sw.js`
**Expected:** Non-zero (≥ 2)
**Fail if:** SW lacks push (showNotification) or notificationclick handlers

### Contract for Task 2 — WhatsApp/Telnyx NOT built (deferral owned here)
**Check type:** command-exit
**Command:** `bash -c 'test ! -f src/lib/notify/whatsapp.ts && [ "$(grep -rci "telnyx\|whatsapp" src/lib/notify 2>/dev/null | paste -sd+ - | bc 2>/dev/null || echo 0)" = "0" ] && echo DEFERRED_OK'`
**Expected:** `DEFERRED_OK`
**Fail if:** A `whatsapp.ts` impl or any Telnyx/WhatsApp reference exists under `src/lib/notify/` — ADR-008 defers that channel; Task 2 lays only the adapter seam

### Contract for Task 2 — webpush channel tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/notify/webpush.test.ts 2>&1 | grep -c "passed\|PASS"`
**Expected:** Non-zero
**Fail if:** Tests fail — error mapping (410→expired, generic→no-throw, missing-keys→no-send) is not proven

### Contract for Task 3 — trigger hooked into stagePendingAction (fire-and-forget wiring)
**Check type:** grep-match
**Command:** `grep -c "webPushChannel\|notifyOnStage" src/lib/agents/pendingActions.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** `notifyOnStage` is not called from staging — the trigger exists but is not hooked into `stagePendingAction`

### Contract for Task 3 — fire-and-forget form
**Check type:** grep-match
**Command:** `grep -c "void notifyOnStage" src/lib/agents/pendingActions.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** `notifyOnStage` is not in the fire-and-forget `void …catch()` form (a throwing hook would break the ADR-003 staging gate)

### Contract for Task 3 — no import cycle
**Check type:** command-exit
**Command:** `grep -c "pendingActions" src/lib/notify/triggers.ts`
**Expected:** `0`
**Fail if:** triggers.ts imports pendingActions (cycle)

### Contract for Task 3 — preferences route uses the preferences lib (wiring)
**Check type:** grep-match
**Command:** `grep -c "loadPreferences\|savePreferences" src/app/api/notify/preferences/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the route re-queries Supabase inline instead of going through the principal-scoped preferences helper

### Contract for Task 3 — routes are principal-gated, not in cron allowlist
**Check type:** grep-match
**Command:** `grep -c "getPrincipal" src/app/api/notify/subscribe/route.ts src/app/api/notify/preferences/route.ts; grep -c "notify" src/proxy.ts`
**Expected:** `getPrincipal` present in both routes; `notify` count in proxy.ts = `0`
**Fail if:** A route does not gate on the session principal, OR a notify route was wrongly added to the cron allowlist

### Contract for Task 3 — trigger + preferences-route tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/notify/triggers.test.ts src/lib/agents/pendingActions.test.ts src/app/api/notify/preferences/route.test.ts 2>&1 | grep -c "passed\|PASS"`
**Expected:** Non-zero
**Fail if:** A send/DB failure throws out of notifyOnStage, the existing pendingActions lifecycle tests regress, OR 401-without-session / principal-scoping assertions fail

### Contract for Task 4 — settings page wires the full subscribe flow
**Check type:** grep-match
**Command:** `grep -c "pushManager.subscribe" src/app/settings/page.tsx; grep -c "/api/notify/subscribe" src/app/settings/page.tsx`
**Expected:** Both non-zero
**Fail if:** The page does not register a push subscription or does not POST it to the subscribe route (UI exists but is not wired)

### Contract for Task 4 — iOS install caveat + nav link
**Check type:** grep-match
**Command:** `grep -Ec "Home Screen|installed|iOS" src/app/settings/page.tsx; grep -c "/settings" src/components/Nav.tsx`
**Expected:** Both non-zero
**Fail if:** Missing the iOS-install note (ADR-008 caveat) or no nav link to /settings

### Contract for whole phase — compiles + builds
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation error

### Contract for whole phase — WhatsApp NOT built (deferred)
**Check type:** command-exit
**Command:** `bash -c 'test ! -f src/lib/notify/whatsapp.ts && ! grep -rq "TELNYX" src/lib/notify 2>/dev/null && echo DEFERRED_OK'`
**Expected:** `DEFERRED_OK`
**Fail if:** A whatsapp.ts impl or Telnyx wiring was built — ADR-008 defers it; only the adapter seam should be ready
