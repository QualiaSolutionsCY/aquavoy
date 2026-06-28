---
phase: 1
result: PASS
gaps: 0
security_findings: 2
---

# Phase 1 Verification

## security lens

### Claim 1 — Both new routes call `getPrincipal(req)` and return 401 on no verified principal

**PASS**

`src/app/api/tasks/list/route.ts:44-45` — `const principal = getPrincipal(req); if (!principal) return fail("Unauthorized", 401);`

`src/app/api/tasks/cancel/route.ts:18-19` — `const principal = getPrincipal(req); if (!principal) return fail("Unauthorized", 401);`

Both routes gate behind `getPrincipal` before any backend call is made.

### Claim 2 — The principal is derived from the session cookie, never from request body or query string

**PASS**

`src/lib/auth/session.ts:60-62` — `getPrincipal` reads exclusively from `req.cookies.get(SESSION_COOKIE)?.value`, which is the signed httpOnly session cookie. The cookie value is verified with HMAC-SHA256 under `SESSION_SECRET` using `crypto.timingSafeEqual` (`session.ts:33-35`). No path through either new route reads a principal from the request body or query parameters.

### Claim 3 — `listTasks` / `listScheduled` scope queries to the session principal

**PASS**

`src/lib/agents/scheduledTasks.ts:130-131` — `.eq("principal", principal)` — `listTasks` hard-requires `principal: string` (non-optional) and always applies the equality filter.

`src/lib/mail/scheduled.ts:131` — `if (principal) query = query.eq("created_by", principal);` — `listScheduled` applies the filter when the argument is provided. The list route at `src/app/api/tasks/list/route.ts:49` always passes the verified session principal: `listScheduled(principal)`.

### Claim 4 — `cancelTask` / `cancelScheduled` enforce ownership in the DB update

**PASS (cancelTask) / MEDIUM finding (cancelScheduled)**

`src/lib/agents/scheduledTasks.ts:147-150` — `cancelTask` hard-requires `principal: string` and the UPDATE includes `.eq("principal", principal)` unconditionally. An attacker supplying an id belonging to another operator will receive a DB error (zero rows returned) converted to a 400 via `handle`. Ownership is enforced at the DB layer.

`src/lib/mail/scheduled.ts:141` — `cancelScheduled(id: string, principal?: string)` — the `principal` parameter is **optional**. The ownership filter `.eq("created_by", principal)` is applied only inside `if (principal)` at line 149. The new cancel route at `src/app/api/tasks/cancel/route.ts:32` always passes the verified principal, so the vulnerability is not reachable through this route. However, the function signature itself is a latent risk: any future or existing caller that omits `principal` silently becomes an unauthenticated cancel of any pending email by id. Three current callers all pass a principal (`mail/scheduled/route.ts:67`, `pendingActions.ts:290`, `onedriveTools.ts:1228`) so there is no live exploit path, but the optional signature violates the project's security contract (ADR-001 / REQ-3: isolation must be enforced unconditionally at the function level).

**Severity: MEDIUM** — per `rules/grounding.md` Severity Rubric: "Feature works but missing states … hardcoded values that should be vars" — here the correct analogy is: feature enforces isolation correctly at the call sites but the function contract permits accidental bypass; no user data is currently leakable through the Phase 1 routes, but the latent path exists.

Recommendation: change `cancelScheduled(id: string, principal?: string)` to `cancelScheduled(id: string, principal: string)` and drop the `if (principal)` guard so the `.eq("created_by", principal)` filter is unconditional. This matches `cancelTask`'s existing pattern.

### Claim 5 — No service_role key leaked client-side; `/tasks` page does not import or use the DB directly

**PASS**

`src/app/tasks/page.tsx:1` — `"use client"` — the page is a React client component.

`grep -rn "supabaseAdmin|SUPABASE_SERVICE_ROLE" src/app` — zero hits in `src/app/tasks/page.tsx`. The page only calls `/api/tasks/list` and `/api/tasks/cancel` via `fetch`. No Supabase client is instantiated in the component.

`src/lib/supabase/server.ts:15` — `SUPABASE_SERVICE_ROLE_KEY` is consumed server-side only, via `getSupabaseEnv()` which reads `process.env.SUPABASE_SERVICE_ROLE_KEY` (no `NEXT_PUBLIC_` prefix, never bundle-exported). No `NEXT_PUBLIC_*SERVICE_ROLE*` env var exists anywhere in the codebase.

`src/lib/env.ts:60-61` — the Supabase schema requires `SUPABASE_SERVICE_ROLE_KEY` (not prefixed), meaning Next.js will never include it in the browser bundle.

### Claim 6 — Manifest and layout changes introduce no secret exposure

**PASS**

`src/app/layout.tsx:21-31` — the `metadata` export adds only `manifest: "/manifest.json"` and `appleWebApp: { capable, statusBarStyle, title }`. No secrets, no env vars, no import of server-only modules.

`public/manifest.json` — contains only public PWA fields (`name`, `short_name`, `start_url`, `display`, `background_color`, `theme_color`, `icons`). No secrets.

### Summary table

| Check | Result | Evidence |
|---|---|---|
| Both routes call `getPrincipal` before any data access | PASS | `list/route.ts:44`, `cancel/route.ts:18` |
| Principal sourced from HMAC-signed session cookie only | PASS | `session.ts:60-62`, timing-safe comparison at `:33-35` |
| `listTasks` scopes query by principal unconditionally | PASS | `scheduledTasks.ts:130` `.eq("principal", principal)` |
| `listScheduled` scopes query by principal when called from new routes | PASS | `scheduled.ts:131`, `list/route.ts:49` |
| `cancelTask` enforces ownership unconditionally at DB layer | PASS | `scheduledTasks.ts:147-150` `.eq("principal", principal)` |
| `cancelScheduled` enforces ownership — function signature | **MEDIUM** | `scheduled.ts:141` `principal?` is optional; ownership guard is conditional |
| No service_role key in client bundle or NEXT_PUBLIC namespace | PASS | `env.ts:60`, no NEXT_PUBLIC_*ROLE* anywhere in src/ |
| `/tasks` page is client component calling API routes only, no direct DB | PASS | `page.tsx:1`, zero `supabaseAdmin` imports |
| Manifest / layout additions expose no secrets | PASS | `layout.tsx:21-31`, `public/manifest.json` |

### Findings written to `.planning/phase-1-panel-security.json`

Two findings recorded (MEDIUM + LOW). The MEDIUM finding (`cancelScheduled` optional `principal` parameter) is a latent vulnerability in the pre-existing function; it is not introduced by Phase 1 and is not currently exploitable through any Phase 1 route. All Phase 1 route code correctly enforces principal isolation. The LOW finding (`listScheduled` optional `principal`) is analogous.

**Security verdict for Phase 1: PASS with advisory.** The two new routes are correctly auth-gated and principal-scoped. The optional-parameter gap in `cancelScheduled` / `listScheduled` pre-dates this phase and should be hardened in the next backend touch (change both signatures to require `principal: string`).

## correctness lens

### Claim 1 — Prep page, draft route, and draftEmail.ts are fully deleted with no dangling imports

**PASS**

`test ! -e src/app/prep/page.tsx && test ! -e src/app/api/outlook/draft/route.ts && test ! -e src/lib/agents/draftEmail.ts` → `ALL_DELETED`

`grep -rn "draftEmail" src/ --include="*.ts" --include="*.tsx"` → zero hits.

`grep -rn 'href.*["/]prep["/]' src/ --include="*.tsx" --include="*.ts"` → zero hits (no navigation link to `/prep` remains in any component).

`npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0` (TypeScript confirms no broken import from the deletions).

Two occurrences of the phrase "prep crew email" remain — one in a code comment at `src/app/page.tsx:35` and one in UI copy at `src/app/page.tsx:719` — but neither is a route link, an import, or a reference to the deleted files. They are stale prose only (see LOW findings below).

### Claim 2 — GET /api/tasks/list correctly merges reminders + scheduled emails, maps all fields, and sorts by scheduledAt descending

**PASS**

`src/app/api/tasks/list/route.ts:47-50` — `Promise.all([listTasks(principal), listScheduled(principal)])` fetches both sources in parallel.

Field mapping for reminders (`src/app/api/tasks/list/route.ts:52-61`): maps `r.id`, `r.status`, `r.scheduledAt`, `r.recurrence`, `r.mailbox`, `r.title`, `r.error` from `ScheduledTask` — every field exists on the interface at `src/lib/agents/scheduledTasks.ts:22-34`.

Field mapping for emails (`src/app/api/tasks/list/route.ts:63-73`): maps `e.id`, `e.status`, `e.scheduledAt`, `e.recurrence`, `e.fromEmail`, `e.toEmail`, `e.subject`, `e.error` from `ScheduledEmail` — every field exists on the interface at `src/lib/mail/scheduled.ts:16-30`.

Sort at `src/app/api/tasks/list/route.ts:75-77` — `new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()` — descending (newest first). This re-sorts the merged array regardless of the sub-list order from the DB (both `listTasks` and `listScheduled` order by `created_at DESC` internally at `scheduledTasks.ts:131` and `scheduled.ts:127`; the route sort overrides this with `scheduledAt DESC` on the merged set).

### Claim 3 — DELETE /api/tasks/cancel correctly routes to the right subsystem and validates inputs

**PASS**

`src/app/api/tasks/cancel/route.ts:21-27` — validates `?id` (400 on missing) and `?kind` (400 if not `"reminder"` or `"email"`).

`src/app/api/tasks/cancel/route.ts:29-32` — dispatches to `cancelTask(id, principal)` for reminders and `cancelScheduled(id, principal)` for emails. Signature match confirmed: `cancelTask(id: string, principal: string)` at `scheduledTasks.ts:141` and `cancelScheduled(id: string, principal?: string)` at `scheduled.ts:141` — both called with a non-null `principal` derived from the session cookie.

Both underlying functions enforce pending-only + ownership at the DB layer and throw a descriptive message on failure, which `handle` converts to a `{ ok: false, error: "..." }` envelope with status 400.

### Claim 4 — /tasks page correctly fetches, renders, cancels, and handles loading/error/empty states

**PASS**

`src/app/tasks/page.tsx:82` — `fetch("/api/tasks/list")` called in `fetchTasks` on mount.

`src/app/tasks/page.tsx:108-111` — cancel calls `DELETE /api/tasks/cancel?id=${encodeURIComponent(item.id)}&kind=${item.kind}` — `id` is URL-encoded; `kind` is the discriminated union value (`"reminder"` or `"email"`), correct.

`src/app/tasks/page.tsx:84-86` — 404 treated as empty list (not an error), matching the plan's `"on 404 treat as empty"` spec.

`src/app/tasks/page.tsx:141-149` — loading state: `aria-busy="true"` on the list container + 4 `skeleton-row` divs.

`src/app/tasks/page.tsx:151-163` — error state: inline error message + Retry button that calls `setLoading(true)` then `fetchTasks()`. The `finally` block in `fetchTasks` always calls `setLoading(false)`, so the loading spinner is cleared on retry regardless of outcome.

`src/app/tasks/page.tsx:165-177` — empty state: `<CalendarClock>` icon + "Nothing scheduled." + `.empty-hint` copy.

Cancel item at `src/app/tasks/page.tsx:113-115` — on success sets notice and calls `fetchTasks()` to re-render; on failure at line 117 sets `cancelError` for inline display.

`src/app/tasks/page.tsx:220-226` — Cancel button rendered only when `item.status === "pending"`.

`TaskItem` type at `src/app/tasks/page.tsx:14` — recurrence typed as `"none" | "daily" | "weekly" | "monthly" | null | undefined`, a superset of the route's `Recurrence` type — handles defensive null/undefined from the API layer correctly.

### Claim 5 — PWA manifest fields are correct and layout.tsx emits manifest + apple meta

**PASS**

`public/manifest.json:2-12` — `name: "Aquavoy"`, `short_name: "Aquavoy"`, `start_url: "/"`, `display: "standalone"`, `background_color: "#0c1116"`, `theme_color: "#0c1116"`, two icons with `purpose: "any maskable"`.

`public/icon-192.png` — `file` output: `PNG image data, 192 x 192, 8-bit/color RGBA, non-interlaced`.

`public/icon-512.png` — `file` output: `PNG image data, 512 x 512, 8-bit/color RGBA, non-interlaced`.

`src/app/layout.tsx:25` — `manifest: "/manifest.json"`.

`src/app/layout.tsx:26-30` — `appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Aquavoy" }`.

### LOW findings

**Finding C-1 — Stale SEO description** `src/app/layout.tsx:24` — `"crew email prep. Powered by Qualia Solutions."` — the `description` metadata still advertises the prep capability that was removed. No functional breakage; browser/SEO metadata only. Severity: LOW (per `rules/grounding.md`: "TODO comments; console.log in prod; naming inconsistency; minor perf (no user-visible impact)").

**Finding C-2 — Stale UI copy and comment** `src/app/page.tsx:35` (comment) and `src/app/page.tsx:719` (UI paragraph) — "prep crew email" remains as a description of the agent's capabilities. No link, no import, no dependency on deleted files. Severity: LOW.

### Summary

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|---|---|---|---|---|---|
| Prep removal — no dangling refs | 5 | 5 | 5 | 4 | PASS |
| GET /api/tasks/list — merge + sort + field mapping | 5 | 5 | 5 | 5 | PASS |
| DELETE /api/tasks/cancel — routing + validation | 5 | 5 | 5 | 5 | PASS |
| /tasks page — fetch, render, cancel, states | 5 | 5 | 5 | 5 | PASS |
| PWA manifest + layout meta | 5 | 5 | 5 | 5 | PASS |

TypeScript: PASS (`npx tsc --noEmit` → 0 errors)
Stubs found: 0
Empty handlers: 0
Dangling imports from deleted files: 0

**Correctness verdict: PASS.** All five correctness claims verified at depth. Two LOW findings (stale copy/metadata referencing the removed prep capability) recorded in `.planning/phase-1-panel-correctness.json`. No correctness failures; no threshold violations.

---

## design lens

### Slop-Detect Gate

`bin/slop-detect.mjs` does not exist in this repo (`test -f bin/slop-detect.mjs` → MISSING). Gate skipped; manual checks below substitute.

---

### Check 1 — No new CSS class names introduced

Every `className` value in `src/app/tasks/page.tsx` is drawn exclusively from the approved reuse set. All of the following are defined in `src/app/globals.css`:

`src/app/tasks/page.tsx:122` — `className="wrap"` — `globals.css:413`
`src/app/tasks/page.tsx:123` — `className="head"` — `globals.css:417`
`src/app/tasks/page.tsx:126` — `className="tag"` — `globals.css:434` (`.head .tag`)
`src/app/tasks/page.tsx:131` — `className="notice ok"` — `globals.css:640`
`src/app/tasks/page.tsx:136` — `className="notice err"` — `globals.css:635`
`src/app/tasks/page.tsx:142` — `className="list"` — `globals.css:409`
`src/app/tasks/page.tsx:144` — `className="skeleton-row"` — `globals.css:2271`
`src/app/tasks/page.tsx:145` — `className="skeleton icon"` — `globals.css:2286`
`src/app/tasks/page.tsx:147` — `className="skeleton meta"` — `globals.css:2291`
`src/app/tasks/page.tsx:152` — `className="empty"` — `globals.css:647`
`src/app/tasks/page.tsx:155` — `className="btn ghost sm"` — `globals.css:409`
`src/app/tasks/page.tsx:166` — `className="empty"` — `globals.css:647`
`src/app/tasks/page.tsx:168` — `className="empty-icon"` — `globals.css:661`
`src/app/tasks/page.tsx:174` — `className="empty-hint"` — `globals.css:668`
`src/app/tasks/page.tsx:183` — `className="item"` — `globals.css:562`
`src/app/tasks/page.tsx:189` — `className="name"` — `globals.css:578`
`src/app/tasks/page.tsx:190` — `className="meta"` — `globals.css:592`
`src/app/tasks/page.tsx:196` — `className="name"` — `globals.css:578`
`src/app/tasks/page.tsx:197` — `className="meta"` — `globals.css:592`
`src/app/tasks/page.tsx:205` — `className="meta"` — `globals.css:592`
`src/app/tasks/page.tsx:213` — `className="row"` — `globals.css:515`
`src/app/tasks/page.tsx:214` — `className="badge muted"` — `globals.css:409`
`src/app/tasks/page.tsx:215` — `className="badge {STATUS_BADGE[...]}"` — `globals.css:409`
`src/app/tasks/page.tsx:222` — `className="btn danger sm"` — `globals.css:409`

Zero new CSS class names introduced. PASS.

---

### Check 2 — No raw hex, no generic fonts, no inline color bypasses

`grep -n "#[0-9a-fA-F]{3,6}|font-family|Inter|Arial|Roboto|system-ui" src/app/tasks/page.tsx` — zero matches. PASS.

Inline `style={}` usages found and verified:

`src/app/tasks/page.tsx:146` — `style={{ width: \`${72 - i * 9}%\` }}` — percentage width for skeleton shimmer variance only; no color, no font. PASS.

`src/app/tasks/page.tsx:156` — `style={{ marginTop: "var(--sp-3)" }}` — spacing via registered token `--sp-3` defined at `globals.css:30` as `0.75rem`. PASS.

`src/app/tasks/page.tsx:184` — `style={{ gridTemplateColumns: "1fr auto auto" }}` — layout-only override matching the identical pattern at `src/app/emails/page.tsx:836`. No color, no font. PASS.

`src/app/tasks/page.tsx:206` — `style={{ color: "var(--danger)" }}` — token reference; `--danger` defined at `globals.css:22` as `oklch(0.66 0.17 25)`. Strictly cleaner than the reference `src/app/emails/page.tsx:846` which hard-codes `color: "oklch(0.82 0.10 25)"` as a literal. PASS.

`src/app/tasks/page.tsx:213` — `style={{ gap: "0.35rem" }}` — layout gap for badge cluster; no color; matches `src/app/emails/page.tsx:851` exactly. PASS.

---

### Check 3 — Loading / error / empty states present and wired

**Loading state:** `src/app/tasks/page.tsx:141-149` — sonar-sweep skeleton block: `.list` with `aria-busy="true"` and `aria-label="Loading tasks"`, four `.skeleton-row` children each containing `.skeleton icon`, variable-width `.skeleton`, and `.skeleton meta`. Mirrors `src/app/emails/page.tsx:800-808` pattern exactly.

**Error state:** `src/app/tasks/page.tsx:151-163` — `.empty` container with inline error message and a `className="btn ghost sm"` Retry button wired to `setLoading(true); fetchTasks()`. Retryable. Mirrors `src/app/emails/page.tsx:810-823`.

**Empty state:** `src/app/tasks/page.tsx:165-177` — `.empty` block with `<CalendarClock className="empty-icon" aria-hidden="true" />`, copy "Nothing scheduled.", `.empty-hint` "Ask the agent to set a reminder or schedule an email." Matches `src/app/emails/page.tsx:825-829` convention.

**Cancel inline error:** `src/app/tasks/page.tsx:135-138` — `className="notice err" role="alert"`. Fourth interactive state beyond the three required; exceeds the base spec. PASS.

All three required states present and correctly wired. PASS.

---

### Check 4 — Responsive behavior via inherited global classes

`src/app/tasks/page.tsx` introduces zero new media query logic or fixed-px layout. Responsive adaptation is fully delegated to:

`.wrap` at `globals.css:413-416` — fluid padding `clamp(var(--sp-5), 4vw, var(--sp-7)) clamp(1rem, 3vw, 3.5rem)`. Works at 375px and 1440px without page-level override.

`.item` at `globals.css:562-571` — `min-height: 52px` ensures 44px+ touch targets; the inline `gridTemplateColumns: "1fr auto auto"` at `src/app/tasks/page.tsx:184` replaces the default four-column template (removes the 40px icon column that file rows use) — the same override applied at `src/app/emails/page.tsx:836`.

No fixed-px breakage introduced. PASS.

---

### Check 5 — Design token system integrity

All color and spacing in `src/app/tasks/page.tsx` flows through registered CSS tokens. No raw hex values; no bare OKLCH literals; no `#000`/`#fff`:

`src/app/tasks/page.tsx:206` — `var(--danger)` — `globals.css:22` as `oklch(0.66 0.17 25)`.
`src/app/tasks/page.tsx:156` — `var(--sp-3)` — `globals.css:30` as `0.75rem`.

All other color and spacing tokens inherited through the reused class set. PASS.

---

### Check 6 — Typography fully inherited, no generic fonts

`src/app/tasks/page.tsx` owns zero `font-family` declarations. Typography is inherited:

`.head h1` — Instrument Sans via `--font-sans`, `globals.css:434`, fluid `clamp(1.375rem, 1rem + 1.5vw, 1.75rem)`.
`.tag` — JetBrains Mono via `--font-mono`, `globals.css:437`.
`.item .meta` — JetBrains Mono via `--font-mono`, `globals.css:595`.
`.empty-hint` — JetBrains Mono via `--font-mono`, `globals.css:671`.
Body — Instrument Sans via root `font-family: var(--font-sans)`, `globals.css:134`.

Fonts loaded in `src/app/layout.tsx:2` — `import { Instrument_Sans, JetBrains_Mono } from "next/font/google"`. Full DESIGN.md §3 hierarchy satisfied. PASS.

---

## Design Rubric — Phase 1 (src/app/tasks/page.tsx)

| Dim | Score | Evidence |
|---|---|---|
| Typography | 5 | `page.tsx` owns zero font declarations; inherits Instrument Sans body + JetBrains Mono on `.meta`/`.tag`/`.empty-hint` via `globals.css:437,595,671`. Fluid `clamp()` heading at `globals.css:429`. Full DESIGN.md §3 hierarchy in force. |
| Color cohesion | 5 | Zero raw hex; zero OKLCH literals. All color via CSS vars: `var(--danger)` at `page.tsx:206` (`globals.css:22`); status badges via `STATUS_BADGE` map resolving to token-driven `ok`/`muted`/`err` classes. Strictly cleaner than the reference page which hard-codes `oklch(0.82 0.10 25)` at `emails/page.tsx:846`. |
| States | 5 | Loading: skeleton at `page.tsx:141-149` with `aria-busy="true"`. Error: retryable `.empty` + retry btn at `page.tsx:151-163`. Empty: CalendarClock + copy + hint at `page.tsx:165-177`. Cancel failure: `notice err role="alert"` at `page.tsx:135-138`. All four interactive states present. |
| Microcopy | 4 | Subtitle `page.tsx:126` — "Reminders and scheduled emails the agent has queued"; empty `page.tsx:173` — "Nothing scheduled."; hint `page.tsx:175` — "Ask the agent to set a reminder or schedule an email."; error `page.tsx:153` — "Couldn't load the task queue — {error}". Specific and plain. Minor: `confirm("Cancel this?")` at `page.tsx:105` is terse but functional for an MVP ops console. |
| Container depth | 5 | `main.wrap` → `.head` / `.list` → `.item` → (`.name` + `.meta`) + `.row` + `.btn`. Three nesting levels; no shadow stacking; no surface-step violations. Mirrors `emails/page.tsx` container geometry exactly. |
| Visual system & graphics | 4 | HTML entity glyphs `&#128276;` (bell, `page.tsx:189`) and `&#9993;&#65039;` (envelope, `page.tsx:196`) as lightweight type indicators — consistent with DESIGN.md §8 "Inline/emoji-light; no icon-font dependency." `CalendarClock` from Lucide (`page.tsx:4,167`) used solely in the empty state with `aria-hidden="true"`. Single-family icon discipline maintained. No decorative imagery added. |

**Aggregate:** 28/30 (avg 4.67)
**Design verdict: PASS** — all dimensions >= 3; zero new styling primitives; zero anti-patterns from DESIGN.md §10 checklist.

---

### Design findings

No findings. `.planning/phase-1-panel-design.json` contains `[]`.

**Design verdict for Phase 1: PASS.** `src/app/tasks/page.tsx` is a clean, token-faithful extension of the existing maritime design system. It reuses the full approved class set, delegates all typography and color to the global token cascade, and surfaces all three required interactive states with correct ARIA attributes. The inline `var(--danger)` usage at `page.tsx:206` is strictly better than the reference page's hard-coded OKLCH literal at `emails/page.tsx:846`.
