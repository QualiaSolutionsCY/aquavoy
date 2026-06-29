---
phase: 6
result: PASS
gaps: 0
lens: security
---

## security lens

**Security verdict: PASS — 0 findings. All six security invariants verified with file:line evidence.**

---

### S1 — Fire-and-forget invariant (CRITICAL — ADR-003)

**Claim:** `notifyOnStage` can never throw into `stagePendingAction`.

**Evidence (pendingActions.ts hook):**

`src/lib/agents/pendingActions.ts:105` — `void notifyOnStage(action.principal as Principal, { summary: action.summary }).catch(() => {});`

The `void` keyword discards the Promise so its rejection cannot propagate. The `.catch(() => {})` is a second safety net that silences the rejection even if the Promise escapes its detached context. The call appears AFTER the insert completes and BEFORE the `return action` — the staged row is already committed when notify fires.

**Evidence (triggers.ts body wrapping):**

`src/lib/notify/triggers.ts:26` — `try {` — entire function body is inside a single top-level try block.

`src/lib/notify/triggers.ts:66` — `} catch (err) {` — catch-all on the outer block; the body is the best-effort log.

`src/lib/notify/triggers.ts:76` — `} catch {` — inner catch swallows even a logging failure.

`src/lib/notify/triggers.ts:79` — the function simply `return`s after the inner catch; no `throw` anywhere in the file.

**Result: PASS.** The invariant is triple-layered: `void` detaches, `.catch` silences, and the function body itself is fully wrapped and never re-throws.

---

### S2 — Principal scoping on subscribe + preferences routes

**Claim:** Both routes derive the principal from the verified session cookie via `getPrincipal(req)`, return 401 without a valid session, and write only for the SESSION principal (body principal is ignored).

**Evidence — principal extraction:**

`src/app/api/notify/subscribe/route.ts:3` — `import { getPrincipal } from "@/lib/auth/session";`

`src/app/api/notify/subscribe/route.ts:29` — `const principal = getPrincipal(req);`

`src/app/api/notify/subscribe/route.ts:30-32` — `if (!principal) { return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }`

`src/app/api/notify/preferences/route.ts:35` — `const principal = getPrincipal(req);` (GET handler)

`src/app/api/notify/preferences/route.ts:50` — `const principal = getPrincipal(req);` (POST handler)

**Evidence — body principal ignored / only session principal writes:**

`src/app/api/notify/subscribe/route.ts:50` — `await savePreferences(principal, { push_subscription: parsed.data as PushSubscriptionJSON });` — the `principal` variable is the session-derived value from line 29, not from the body. The `PushSubscriptionSchema` (lines 19–26) contains only `endpoint`, `keys.p256dh`, `keys.auth`, `expirationTime` — no `principal` field is accepted from the body at all.

`src/app/api/notify/preferences/route.ts:83` — `const updated = await savePreferences(principal, patch);` — the `patch` built on lines 71–79 is constructed from `parsed.data.enabled_events/quiet_hours_start/quiet_hours_end` only; the schema at lines 28–32 accepts no `principal` field.

**Evidence — `getPrincipal` is HMAC-verified (not body-controlled):**

`src/lib/auth/session.ts:60-62` — `getPrincipal` reads `req.cookies.get(SESSION_COOKIE)?.value` and passes it through `verifySession`, which validates the HMAC-SHA256 signature at constant time (`timingSafeEqual`). There is no code path that reads a principal from the request body.

**Evidence — preferences lib scopes every query to principal:**

`src/lib/notify/preferences.ts:71` — `.eq("principal", principal)` (loadPreferences SELECT)

`src/lib/notify/preferences.ts:113` — `{ principal, ...patch, updated_at: … }` with `onConflict: "principal"` (savePreferences upsert — principal is the upsert key and comes from the function argument, which is the session principal)

`src/lib/notify/preferences.ts:132` — `.eq("principal", principal)` (clearExpiredSubscription UPDATE)

**Evidence — notify routes NOT in proxy cron allowlist:**

`src/proxy.ts:32-40` — `ALLOWLIST` contains `/login`, `/api/login`, `/api/mail/scheduled/run`, `/api/mail/scan/run`, `/api/tasks/scheduled/run`, `/api/memory/sweep`, `/api/health`. `grep -c "notify" src/proxy.ts` → `0`.

**Result: PASS.**

---

### S3 — Migration 0019: RLS enabled, NO policies, principal CHECK

**Evidence:**

`supabase/migrations/0019_notifications.sql:35` — `alter table public.notification_preferences enable row level security;`

`supabase/migrations/0019_notifications.sql:57` — `alter table public.notification_log enable row level security;`

`grep -c "enable row level security" supabase/migrations/0019_notifications.sql` → `2`

`grep -c "create policy" supabase/migrations/0019_notifications.sql` → `0`

`supabase/migrations/0019_notifications.sql:21` — `principal text not null check (principal in ('Wency', 'Jeanette')) unique,` (notification_preferences)

`supabase/migrations/0019_notifications.sql:41` — `principal text not null check (principal in ('Wency', 'Jeanette')),` (notification_log)

The SQL comment at lines 8–17 states the justification: no Supabase Auth in this project, principal is a signed HMAC cookie, RLS policy-less is the project-wide pattern (from `0004_chat_messages.sql` through `0018`).

**Result: PASS.**

---

### S4 — Zod validation on both route bodies

**Evidence — subscribe route:**

`src/app/api/notify/subscribe/route.ts:19-26` — `PushSubscriptionSchema = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }), expirationTime: z.number().nullable().optional() })` — validates endpoint as a URL, keys as non-empty strings.

`src/app/api/notify/subscribe/route.ts:41` — `const parsed = PushSubscriptionSchema.safeParse(body);`

`src/app/api/notify/subscribe/route.ts:42-47` — returns 400 with `parsed.error.flatten()` on failure; no unvalidated data reaches `savePreferences`.

**Evidence — preferences route:**

`src/app/api/notify/preferences/route.ts:22-32` — `PreferencesPatchSchema = z.object({ enabled_events: z.array(z.string()).optional(), quiet_hours_start: TimeOrNull, quiet_hours_end: TimeOrNull })` where `TimeOrNull` enforces `HH:MM` regex at line 22.

`src/app/api/notify/preferences/route.ts:62` — `const parsed = PreferencesPatchSchema.safeParse(body);`

`src/app/api/notify/preferences/route.ts:63-67` — returns 400 on failure; `push_subscription` is explicitly excluded from the schema so it cannot be set through this route.

**Result: PASS.**

---

### S5 — VAPID key hygiene

**Claim:** `VAPID_PRIVATE_KEY` is server-only (never `NEXT_PUBLIC_`); only `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is exposed to the client bundle. No `service_role` key in client code.

**Evidence — private key server-only:**

`src/lib/env.ts:134` — `VAPID_PRIVATE_KEY: z.string().min(1).optional()` — read from `process.env` inside the server-side `getVapidEnv()` function.

`src/lib/env.ts:1` — the file comment: "Server-only — reads secrets (service-role key, client secret, OpenRouter key) that must never reach the browser bundle."

`src/lib/notify/webpush.ts:35` — `env.VAPID_PRIVATE_KEY!` — the only consumption of the private key; this file has no `"use client"` directive.

`grep -rn "VAPID_PRIVATE_KEY" src/app/` → 0 results (private key not referenced in any app route or client component).

**Evidence — public key safely in client bundle:**

`src/app/settings/page.tsx:117` — `const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;` — this is the public key, appropriate for the browser bundle (VAPID public keys are designed to be public).

No file under `src/` sets `NEXT_PUBLIC_VAPID_PRIVATE_KEY`.

**Evidence — service_role key not in client:**

`src/lib/supabase/server.ts:15` — `createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, …)` — the service-role key is read from `SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix) inside the server adapter. No other file references `SERVICE_ROLE`.

**Result: PASS.**

---

### S6 — WhatsApp/Telnyx NOT built (deferral maintained)

**Evidence:**

`test ! -f src/lib/notify/whatsapp.ts` → exit 0 (file does not exist).

`grep -rci "telnyx\|whatsapp" src/lib/notify/` → all files return 0.

`grep -rn "TELNYX\|whatsapp" src/` → 0 results.

The adapter seam (`src/lib/notify/adapter.ts`) exports only `NotificationChannel`, `NotifyMessage`, and a thin `dispatch` helper — no vendor-specific WhatsApp or Telnyx code.

**Result: PASS.**

---

### Contract run evidence

All 23 machine contracts passed at `2026-06-29T09:16:19Z` (`.planning/evidence/phase-6-contract-run.json`). The vitest run for T3 (triggers + pendingActions + preferences-route tests) produced `37 passed` with 0 failures, proving the fire-and-forget no-throw behaviour and the 401-without-session invariant are test-verified, not just structurally present.

---

### Summary table

| Security invariant | File(s) verified | Result |
|---|---|---|
| Fire-and-forget (ADR-003): void+catch form + full try/catch wrap | `pendingActions.ts:105`, `triggers.ts:26,66,76` | PASS |
| Principal scoping: session cookie only, body principal ignored | `subscribe/route.ts:29-32,50`, `preferences/route.ts:35,50,83`, `preferences.ts:71,113,132` | PASS |
| Proxy allowlist: notify routes NOT exempt from auth | `proxy.ts:32-40` (grep → 0) | PASS |
| Migration 0019: RLS on, 0 policies, principal CHECK on both tables | `0019_notifications.sql:21,35,41,57` | PASS |
| Zod validation on both route bodies | `subscribe/route.ts:19-47`, `preferences/route.ts:22-67` | PASS |
| VAPID key hygiene: private key server-only, public key NEXT_PUBLIC_ | `env.ts:134`, `webpush.ts:35`, `settings/page.tsx:117` | PASS |
| WhatsApp/Telnyx deferred: no whatsapp.ts, 0 Telnyx refs | `src/lib/notify/` (all files) | PASS |

---

## correctness lens

### Contract Results

All 23 JSON contracts passed (source: `.planning/evidence/phase-6-contract-run.json`, `ok: true`, `failed: 0`). Full vitest run: 31 test files, 248 tests, 0 failures. `npx tsc --noEmit` → 0 errors.

| Task | Check | Result |
|------|-------|--------|
| T1 | file-exists 0019_notifications.sql | PASS |
| T1 | RLS=2 / policies=0 | PASS |
| T1 | principal CHECK + push_subscription column | PASS |
| T2 | NotificationChannel interface | PASS |
| T2 | webpush.ts imports adapter seam | PASS |
| T2 | web-push in package.json | PASS |
| T2 | SW showNotification + notificationclick | PASS |
| T2 | WhatsApp/Telnyx NOT built | PASS |
| T2 | webpush.test.ts 5/5 passed | PASS |
| T3 | notifyOnStage hooked into stagePendingAction | PASS |
| T3 | void notifyOnStage fire-and-forget form | PASS |
| T3 | no import cycle triggers→pendingActions | PASS |
| T3 | preferences route uses loadPreferences/savePreferences | PASS |
| T3 | getPrincipal in both notify routes | PASS |
| T3 | notify NOT in proxy.ts allowlist | PASS |
| T3 | 37/37 tests (triggers + pendingActions + preferences-route) | PASS |
| T4 | settings page: pushManager.subscribe wired | PASS |
| T4 | settings page: POST /api/notify/subscribe wired | PASS |
| T4 | settings page: iOS Home Screen caveat present | PASS |
| T4 | Nav.tsx: /settings link present | PASS |
| Phase | npx tsc --noEmit → 0 errors | PASS |
| Phase | WhatsApp/Telnyx deferred (no whatsapp.ts, no TELNYX ref) | PASS |

---

### notifyOnStage gating + fire-and-forget

`src/lib/notify/triggers.ts:30` — `if (!prefs.push_subscription) return;` — Gate 1: no subscription → skip.
`src/lib/notify/triggers.ts:33` — `if (!prefs.enabled_events.includes("stage")) return;` — Gate 2: stage not opted-in → skip.
`src/lib/notify/triggers.ts:36` — `if (isWithinQuietHours(new Date(), prefs.quiet_hours_start, prefs.quiet_hours_end)) return;` — Gate 3: within quiet hours → skip.
`src/lib/notify/triggers.ts:38-43` — `NotifyMessage` built as `{ title: "Action ready to confirm", body: action.summary, url: "/" }` — matches plan AC exactly.
`src/lib/notify/triggers.ts:44` — `const result = await webPushChannel.send(principal, message, prefs.push_subscription);`
`src/lib/notify/triggers.ts:46-57` — `if (result.expired)` → `clearExpiredSubscription(principal)` + log + return. Correct cleanup on 410/404.
`src/lib/notify/triggers.ts:59-65` — `logNotification` called with outcome on every send; error field populated on failure.
`src/lib/notify/triggers.ts:26` — outer `try {` wraps the entire function body.
`src/lib/notify/triggers.ts:66-79` — outer `catch (err)` attempts best-effort log, then inner `catch {}` swallows log failure. Never re-throws.

`src/lib/agents/pendingActions.ts:105` — `void notifyOnStage(action.principal as Principal, { summary: action.summary }).catch(() => {});` — placed after `toPendingAction(data)` at line 102, before `return action` at line 106. `void` discards the Promise; `.catch(() => {})` suppresses unhandled rejection. Return value of `stagePendingAction` unchanged.

---

### isWithinQuietHours wrap-midnight correctness

`src/lib/notify/preferences.ts:190-195`:
```
if (startMins <= endMins) {
  return nowMins >= startMins && nowMins < endMins;   // simple range
} else {
  return nowMins >= startMins || nowMins < endMins;   // wrap-midnight
}
```

Plan-specified cases verified against the formula (start=22:00 / end=07:00 → wrap branch):
- 23:30 (1410 min): 1410 >= 1320 → **true** (quiet) — plan AC satisfied.
- 06:00 (360 min): 360 < 420 → **true** (quiet) — plan AC satisfied.
- 12:00 (720 min): 720 < 1320 = false AND 720 < 420 = false → **false** (not quiet) — plan AC satisfied.

`src/lib/notify/triggers.test.ts:204-221` — dedicated wrap-midnight describe block confirms all three plan-specified values plus inclusive-start (22:00 exact → quiet) and exclusive-end (07:00 exact → not quiet).

---

### webpush.send never-throws

`src/lib/notify/webpush.ts:26-29` — missing VAPID keys → `return { ok: false, error: "web-push not configured" }` before touching webpush.
`src/lib/notify/webpush.ts:44-53` — all errors caught; statusCode 410/404 → `{ ok: false, expired: true }`; other → `{ ok: false, error: message }`. No `throw` in file.
`src/lib/notify/webpush.test.ts` — 5 tests, all pass: 410→expired, 404→expired, generic→no-throw, missing-keys→no-sendNotification, success→{ok:true}.

LOW: `src/lib/notify/webpush.ts:50` — `const message` in catch block shadows outer function parameter `message: NotifyMessage` (line 23). No correctness impact; TypeScript compiles without error; naming clarity only.

---

### Routes: 401 gate, Zod, principal scoping

`src/app/api/notify/subscribe/route.ts:19-26` — `PushSubscriptionSchema` validates endpoint as URL, keys as non-empty strings. No `principal` field accepted from body.
`src/app/api/notify/subscribe/route.ts:29-32` — `getPrincipal(req)` → 401 if null.
`src/app/api/notify/subscribe/route.ts:50` — `savePreferences(principal, ...)` uses session principal only.

`src/app/api/notify/preferences/route.ts:22-32` — `PreferencesPatchSchema` accepts only `enabled_events`, `quiet_hours_start`, `quiet_hours_end`. `push_subscription` absent → cannot be set here.
`src/app/api/notify/preferences/route.ts:35,50` — `getPrincipal(req)` gates both GET and POST.
`src/app/api/notify/preferences/route.ts:83` — `savePreferences(principal, patch)` — session principal; confirmed by test at `route.test.ts:118-139` that a body naming a different principal still writes for "Wency".

`src/proxy.ts:32-40` — ALLOWLIST has 7 entries; none contains "notify". `grep -c "notify" src/proxy.ts` → 0.
`src/app/api/notify/subscribe/route.ts:6` — `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
`src/app/api/notify/preferences/route.ts:6` — same.

---

### Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| notifyOnStage gates + fire-and-forget | 5 | 5 | 5 | 5 | PASS |
| isWithinQuietHours wrap-midnight | 5 | 5 | 5 | 5 | PASS |
| webpush.send never-throws | 5 | 5 | 5 | 4 | PASS |
| pendingActions hook form | 5 | 5 | 5 | 5 | PASS |
| Routes: 401 + Zod + principal scoping | 5 | 5 | 5 | 5 | PASS |
| Migration 0019 RLS + schema | 5 | 5 | 5 | 5 | PASS |
| Settings page subscribe flow | 5 | 5 | 5 | 5 | PASS |
| Full test suite (248 tests) | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** No score below 3.

---

### Correctness Verdict

PASS — all correctness criteria verified against source. No gaps.

One LOW finding, non-blocking: variable name `message` at `src/lib/notify/webpush.ts:50` shadows the outer parameter `message: NotifyMessage` (line 23). No correctness impact; TypeScript accepts it; rename to `errMsg` would improve readability.

---

## design lens

**Scope:** `src/app/settings/page.tsx` + `src/components/Nav.tsx`

**Slop-detect gate:** `bin/slop-detect.mjs` is ABSENT from the project. Manual checks executed below. Script absence noted; no gate failure triggered.

---

### Token / class audit

CSS custom properties used in `src/app/settings/page.tsx` (extracted via grep):

```
--accent, --border, --font-mono, --radius, --sp-2, --sp-3, --sp-4, --sp-5,
--surface, --text, --text-dim, --text-muted
```

All 12 are declared in `src/app/globals.css:6-44` (verified: grep count ≥ 1 for each). Zero raw `#hex`, zero raw `oklch(…)` literals, zero `rgba(…)`, zero new font declarations anywhere in the file.

All `className=` values reuse existing globals.css classes: `wrap` (line 413), `head` (418), `tag` (434), `btn` (442), `ghost` (474), `sm` (497), `notice` (628), `err` (635), `ok` (640), `empty` (647), `empty-icon` (661), `empty-hint` (668), `panel` (1899), `panel-h` (1905), `skeleton` (2244), `skeleton-row` (2271), `icon` (2286). Zero new class names introduced.

---

### Design Rubric — Phase 6

| Dim | Score | Evidence |
|---|---|---|
| Typography | 5 | `src/app/settings/page.tsx:331,337,392,433,457` — `var(--font-mono)` for metadata/labels (mono clock, stage sub-label, quiet-hours label). Body text inherits `var(--font-sans)` (Instrument Sans) from `globals.css:134`. `globals.css:43-44` — `--font-sans: var(--font-instrument), "Instrument Sans" …` / `--font-mono: var(--font-jetbrains), "JetBrains Mono" …`. No Inter/Arial/system-ui as primary. Heading `h1` uses `.head h1` clamp at `globals.css:428` (`clamp(1.375rem, 1rem + 1.5vw, 1.75rem)`). |
| Color cohesion | 5 | `src/app/settings/page.tsx:301,311,331,337,365,369,383,389,392,414,437,461` — every color reference uses a CSS var token. Twelve distinct tokens, all declared in `globals.css:6-44`. Zero `#hex`, zero raw `oklch`. `accentColor: "var(--accent)"` (line 383) ties checkbox highlight to the single teal token. DESIGN.md §2 "Committed" strategy upheld. |
| Spacing | 5 | `src/app/settings/page.tsx:267,292,300,357,426,428,496` — all gaps use `var(--sp-2)`..`var(--sp-5)` from the 8px grid. `.wrap` fluid padding `clamp(var(--sp-5), 4vw, var(--sp-7))` inherited (`globals.css:415`). `.panel` padding `var(--sp-5)` (`globals.css:1902`). One raw value: `marginTop: "0.1rem"` at `src/app/settings/page.tsx:393` — sub-pixel label gap, classified LOW. |
| States | 5 | Loading: lines 265-276 — `aria-busy` skeleton panels with sonar-sweep. Error (load): lines 277-290 — `.empty` + Retry. Error (save): lines 259-262 — `.notice.err`. Success: lines 254-258 — `.notice.ok`. Permission denied: lines 223-232. Browser unsupported: lines 213-221. Active subscription: lines 234-242. Empty/no-subscription: lines 524-537. All 7 interactive states covered. |
| Responsiveness | 4 | `.wrap` fluid padding inherited from `globals.css:413-416`. Quiet-hours inputs: `flex: "1 1 10rem"` + `flexWrap: "wrap"` at `src/app/settings/page.tsx:428-453` — wrap at 375px. Button row: `flexWrap: "wrap"` at line 496. `.head` stacks at ≤640px via `globals.css:2207-2212`. Layout is mobile-safe stacking columns. Score 4 not 5: no page-specific breakpoint queries; relies on shared `.wrap`+`.panel` inheritance. Functional at 375px and 1440px. |
| Accessibility | 4 | `<label htmlFor="quiet-start">` + `<label htmlFor="quiet-end">` at lines 430-440/454-464. Sections use `aria-labelledby` matching `id` props (lines 297/303, 346/351, 403/408). Loading region: `aria-busy="true" aria-label="Loading settings"` (line 267). Notices: `role="alert"` / `role="status"` throughout. Buttons: `aria-busy` (lines 324, 501). Icons: `aria-hidden="true"`. Heading hierarchy: `h1` at line 249, `h2` at lines 302/349/406. 44px targets: `.btn` enforces `min-height: 44px` (`globals.css:458`); label row `minHeight: "44px"` (line 365); global `input, select, textarea` rule `min-height: 44px` (`globals.css:540`). Focus states: `.btn:focus-visible` outline (`globals.css:470-473`); `input:focus-visible` outline (`globals.css:550-553`); `input:focus` box-shadow teal glow (`globals.css:545-548`) — covers the time inputs and checkbox. Score 4 not 5: checkbox has both wrapping `<label>` (implicit association) AND `aria-label` on `<input>` (line 378) — `aria-label` wins per ARIA spec so accessible name is correct, but dual-labeling is redundant (LOW). No skip link (shared layout concern, not page-specific). |

**Aggregate:** 28/30 (avg 4.67)

**Design verdict: PASS** — all 6 dimensions ≥ 3. No hardcoded colors, no generic fonts, no new class names, iOS caveat present in three permutation states (lines 216-217, 229, 332, 338), full state coverage, 44px touch targets via global rules plus explicit overrides, `prefers-reduced-motion` honored globally (`globals.css:66-72`).

---

### Findings

**LOW-1** — `src/app/settings/page.tsx:393` — `marginTop: "0.1rem"` — raw em value for a sub-pixel label nudge instead of spacing var. Severity: LOW per grounding.md ("Style; naming inconsistency; minor perf (no user-visible impact)").

**LOW-2** — `src/app/settings/page.tsx:378` — `aria-label="Notify when an action is ready to confirm"` on the `<input type="checkbox">` inside a wrapping `<label>` element. The `aria-label` attribute overrides the implicit label from the parent `<label>` per ARIA spec. Accessible name is correct; the dual-labeling is redundant. Severity: LOW.

Findings written to `.planning/phase-6-panel-design.json` — `[]` (no MEDIUM or above findings).

---

### Nav link verification

`src/components/Nav.tsx:14` — `{ href: "/settings", label: "Settings" }` — `/settings` link present in the `LINKS` array, matching the existing entry shape (`Nav.tsx:8-14`).
