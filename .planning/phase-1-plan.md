---
phase: 1
goal: "Land three agreed no-client-input wins before Wency's July office visit: remove the prep page, add a /tasks scheduled-tasks oversight page over the existing reminders + scheduled-email backend, and ship a real PWA manifest so the app installs standalone on iPhone."
tasks: 4
waves: 2
---

# Phase 1: Quick wins

**Goal:** `/prep` is gone (404, no nav/footer link, dead CSS + draft route + orphaned `draftEmail.ts` deleted, no agent tool path broken); `/tasks` renders a merged reminders+scheduled-emails timeline (status, type, mailbox/owner, recurrence, principal-scoped cancel, loading/error/empty states); a real PWA manifest + apple-mobile-web-app meta let the app install standalone on iOS.
**Why this phase:** These are the three agreed, low-risk wins the client can see immediately at the July office visit — they need zero client input and de-risk the bigger invoice-automation phases that follow.

---

## Task 1 — Remove the prep page (page, links, CSS, draft route, orphaned lib)
**Wave:** 1
**Persona:** none
**Files:**
- DELETE `src/app/prep/page.tsx`
- DELETE `src/app/api/outlook/draft/route.ts`
- DELETE `src/lib/agents/draftEmail.ts` (confirmed orphaned — see Why)
- MODIFY `src/components/Nav.tsx` (remove `/prep` link at `Nav.tsx:13`; add `/tasks` link)
- MODIFY `src/components/Footer.tsx` (remove `/prep` link at `Footer.tsx:9`; add `/tasks` link)
- MODIFY `src/app/globals.css` (delete the `EMAIL PREP` block at lines 1899–1911: the comment, `.prep-grid` rule, and its `@media (max-width: 720px)` rule)
**Depends on:** none

**Why:** D-prep-removal (scope-m6.md:20, 26): "prep is removed, not replaced." The prep feature is being retired. Grounding confirmed `draftEmail` is referenced ONLY by `src/app/api/outlook/draft/route.ts:3,27` and the prep page at `src/app/prep/page.tsx:140` — `grep -rn "draftEmail\|draft_email"` against `src/lib/agents/onedriveTools.ts` and all `src/lib/agents/*.ts` returned ZERO tool-registry hits, so once the route and page are gone `draftEmail.ts` is fully orphaned and must be deleted (no agent `TOOL_DEFINITIONS` path references it, so nothing breaks). Adding the `/tasks` link here (rather than in Task 3) keeps both Nav/Footer edits in one task and avoids a write conflict with the page task.

**Acceptance Criteria:**
- Visiting `/prep` returns a 404 (the route directory no longer exists).
- Neither the desktop nav rail, the mobile drawer, nor the footer shows a "Prep" link; all three show a "Tasks" link pointing at `/tasks`.
- `.prep-grid` and the `EMAIL PREP` comment block no longer exist in `globals.css`.
- The draft API route and `src/lib/agents/draftEmail.ts` are deleted; `npx tsc --noEmit` reports no broken import.
- No agent tool definition references `draftEmail` (the 17-tool registry is unchanged).

**Action:**
1. Delete the three files: `src/app/prep/page.tsx`, `src/app/api/outlook/draft/route.ts`, `src/lib/agents/draftEmail.ts`. (If `src/app/prep/` is now empty, remove the empty directory.)
2. In `src/components/Nav.tsx`, edit the `LINKS` array (lines 8–14): remove `{ href: "/prep", label: "Prep" }` and add `{ href: "/tasks", label: "Tasks" }` after the Finance entry. Keep the array `as const`.
3. In `src/components/Footer.tsx`, edit the `LINKS` array (lines 5–10): remove the `/prep` entry and add `{ href: "/tasks", label: "Tasks" }`.
4. In `src/app/globals.css`, delete lines 1899–1911 (the `/* ===… EMAIL PREP …=== */` comment, the `.prep-grid { … }` rule, and the `@media (max-width: 720px) { .prep-grid { … } }` rule). Leave the `/* ── Panels ── */` block that follows it intact.

**Validation:** (builder self-check)
- `test ! -e src/app/prep/page.tsx && test ! -e src/app/api/outlook/draft/route.ts && test ! -e src/lib/agents/draftEmail.ts && echo DELETED` → `DELETED`
- `grep -rn "prep\|draftEmail\|prep-grid" src/components/Nav.tsx src/components/Footer.tsx src/app/globals.css | grep -i prep | wc -l` → `0`
- `grep -c "/tasks" src/components/Nav.tsx src/components/Footer.tsx` → each file ≥ 1
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/components/Nav.tsx @src/components/Footer.tsx @.planning/scope-m6.md

---

## Task 2 — Add the two principal-scoped tasks API routes (list + cancel) over the existing backend
**Wave:** 1
**Persona:** backend
**Files:**
- CREATE `src/app/api/tasks/list/route.ts` — exports `GET(req): Promise<NextResponse>`
- CREATE `src/app/api/tasks/cancel/route.ts` — exports `DELETE(req): Promise<NextResponse>`
**Depends on:** none

**Why:** REQ-24 / scope-m6.md:21: the `/tasks` oversight page needs a merged, principal-scoped read of reminders + scheduled emails and a cancel action. The backend already exists — `listTasks`/`cancelTask` in `src/lib/agents/scheduledTasks.ts:123,141` (principal-scoped via `.eq("principal", principal)`) and `listScheduled`/`cancelScheduled` in `src/lib/mail/scheduled.ts:122,141` (principal-scoped via `.eq("created_by", principal)`). These routes are thin wiring: auth-gate with `getPrincipal`, merge the two lists into one `scheduled_at`-sorted timeline, and route a cancel to whichever subsystem owns the id. Reuse the established `handle/ok/fail` envelope and the exact 401 pattern from `src/app/api/mail/scheduled/route.ts`.

**Acceptance Criteria:**
- `GET /api/tasks/list` with a valid session returns `{ ok: true, data: TaskItem[] }` where each item carries a `kind` (`"reminder" | "email"`), id, status, scheduledAt, recurrence, and a label of who/what it concerns (reminder: `title` + `mailbox`; email: `subject` + `fromEmail → toEmail`), sorted by `scheduledAt` descending.
- The merged list contains ONLY the calling principal's own rows — a reminder created by Wency never appears for Jeanette (reminders scoped by `principal`, emails by `created_by`).
- `GET /api/tasks/list` with no/invalid session returns 401 `{ ok: false, error: "Unauthorized" }`.
- `DELETE /api/tasks/cancel?id={id}&kind={reminder|email}` cancels only a pending row the principal owns and returns the cancelled row; missing `id` or `kind` → 400; no session → 401.

**Action:**
1. `src/app/api/tasks/list/route.ts`: `import { NextRequest, NextResponse } from "next/server"`, `import { handle, ok, fail } from "@/lib/http"`, `import { getPrincipal } from "@/lib/auth/session"`, `import { listTasks } from "@/lib/agents/scheduledTasks"`, `import { listScheduled } from "@/lib/mail/scheduled"`. Set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` (match `src/app/api/mail/scheduled/route.ts:7-8`). In `GET`, call `handle(async () => { const principal = getPrincipal(req); if (!principal) return fail("Unauthorized", 401); … })`. Inside, `Promise.all([listTasks(principal), listScheduled(principal)])`, then map each to a unified `TaskItem` shape:
   - reminder → `{ kind: "reminder", id, status, scheduledAt, recurrence, mailbox, title, error }`
   - email → `{ kind: "email", id, status, scheduledAt, recurrence, fromEmail, toEmail, subject, error }`
   Concat both arrays and sort by `new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()` (descending, newest first). Return `ok(merged)`.
2. `src/app/api/tasks/cancel/route.ts`: same imports plus `import { cancelTask } from "@/lib/agents/scheduledTasks"` and `import { cancelScheduled } from "@/lib/mail/scheduled"`. In `DELETE`, gate on `getPrincipal`; read `const id = req.nextUrl.searchParams.get("id")` and `const kind = req.nextUrl.searchParams.get("kind")` (mirror the `?id` read at `src/app/api/mail/scheduled/route.ts:65`). If `!id` → `fail("Missing ?id query parameter", 400)`; if `kind !== "reminder" && kind !== "email"` → `fail("Missing or invalid ?kind (reminder|email)", 400)`. Then `const row = kind === "reminder" ? await cancelTask(id, principal) : await cancelScheduled(id, principal); return ok(row);`. The underlying functions already enforce pending-only + principal ownership and throw a clear message that `handle` converts to a 400/500 envelope.
3. Do NOT add new DB queries or change the lib functions — these routes are pure wiring over the existing four functions.

**Validation:** (builder self-check)
- `test -f src/app/api/tasks/list/route.ts && test -f src/app/api/tasks/cancel/route.ts && echo EXISTS` → `EXISTS`
- `grep -c "getPrincipal" src/app/api/tasks/list/route.ts src/app/api/tasks/cancel/route.ts` → each ≥ 1
- `grep -E "listTasks|listScheduled" src/app/api/tasks/list/route.ts | wc -l` → ≥ 2
- `grep -E "cancelTask|cancelScheduled" src/app/api/tasks/cancel/route.ts | wc -l` → ≥ 2
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/api/mail/scheduled/route.ts @src/lib/agents/scheduledTasks.ts @src/lib/mail/scheduled.ts @src/lib/auth/session.ts @src/lib/http.ts

---

## Task 3 — Build the /tasks oversight page (merged timeline, cancel, loading/error/empty states)
**Wave:** 2
**Persona:** frontend
**Files:**
- CREATE `src/app/tasks/page.tsx` — default-exports the `Tasks` client component
**Depends on:** Task 2 (consumes `GET /api/tasks/list` + `DELETE /api/tasks/cancel`)

**Why:** REQ-24 / scope-m6.md:21: Wency needs one oversight surface for everything the agent has queued — reminders AND scheduled emails — in a single timeline (D: "one merged timeline, not tabs"), with a status badge, type indicator, mailbox/owner, recurrence, and a working cancel. It must match the established page style so it feels native to the app.

**Acceptance Criteria:**
- `/tasks` renders ONE merged list of reminders + scheduled emails sorted newest-first (not two tabs), each row showing: a type indicator (Reminder vs Email), status badge (pending/sent/failed/cancelled), the who/what (reminder: title + mailbox; email: subject + from→to), recurrence label, and the scheduled time in Amsterdam tz.
- Pending rows show a "Cancel" button that hits `DELETE /api/tasks/cancel?id=&kind=`, confirms first, and on success removes/updates the row by re-fetching; failed cancels surface an inline error.
- The page shows a sonar-sweep skeleton while loading, a retryable error state if the fetch fails, and a friendly empty state ("Nothing scheduled") when the list is empty — mirroring `src/app/emails/page.tsx:799-868`.
- Works at 375px (mobile) and 1440px (desktop): the `.item` grid and `.wrap`/`.head` layout already adapt; no fixed-px layout introduced.

**Action:**
1. Start from the structure of `src/app/emails/page.tsx`: `"use client"`, `useCallback`/`useEffect`/`useState`, the `Envelope<T>` type, `fmtAmsterdam(iso)` formatter, `STATUS_BADGE` map (`pending:"muted", sent:"ok", failed:"err", cancelled:"muted"`), and `recurrenceLabel` (copy these small helpers in — locality over a shared util, per architecture rule 2).
2. Define the row type matching Task 2's API: `type TaskItem = { kind: "reminder"; id; status; scheduledAt; recurrence; mailbox; title; error } | { kind: "email"; id; status; scheduledAt; recurrence; fromEmail; toEmail; subject; error }`. Read `recurrence` defensively (a missing/`"none"`/unknown value reads as "One-time" via `recurrenceLabel`).
3. `fetchTasks` (useCallback): `GET /api/tasks/list`, parse `Envelope<TaskItem[]>`, set state; on 404 treat as empty; finally clear `loading`. Call it in a `useEffect` on mount.
4. `cancelItem(item)`: `if (!confirm("Cancel this?")) return;` then `DELETE /api/tasks/cancel?id=${item.id}&kind=${item.kind}`, parse envelope, on success set a notice and `await fetchTasks()`; on failure set an inline error.
5. Layout: a `<main className="wrap">` with a `.head` (`<h1>Aquavoy · Tasks</h1>` + a `.tag` subtitle "Reminders and scheduled emails the agent has queued"), then a single `.list` of `.item` rows (use `gridTemplateColumns: "1fr auto auto"` like emails). Per row: a `.name` showing the type + main label (Reminder → `🔔 {title}` with `.meta` `{mailbox} · {fmtAmsterdam(scheduledAt)}`; Email → `✉️ {subject}` with `.meta` `{fromEmail} → {toEmail} · {fmtAmsterdam(scheduledAt)}`), a `.row` of `<span className="badge muted">{recurrenceLabel}</span>` + `<span className={`badge ${STATUS_BADGE[status] ?? "muted"}`}>{status}</span>`, and a `<button className="btn danger sm">Cancel</button>` rendered only when `status === "pending"`.
6. States: loading → the `skeleton-row` block from `emails/page.tsx:800-808`; error → the retryable `.empty` block; empty → an `.empty` with a Lucide `CalendarClock` icon and copy "Nothing scheduled." + an `.empty-hint` "Ask the agent to set a reminder or schedule an email." Do NOT invent new CSS classes — reuse `.wrap .head .tag .list .item .name .meta .badge .btn .empty .empty-hint .skeleton-row .skeleton`.

**Validation:** (builder self-check)
- `test -f src/app/tasks/page.tsx && echo EXISTS` → `EXISTS`
- `grep -c "/api/tasks/list" src/app/tasks/page.tsx` → ≥ 1
- `grep -c "/api/tasks/cancel" src/app/tasks/page.tsx` → ≥ 1
- `grep -E "skeleton-row|aria-busy" src/app/tasks/page.tsx | wc -l` → ≥ 1 (loading state present)
- `grep -c "empty" src/app/tasks/page.tsx` → ≥ 1 (empty state present)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/emails/page.tsx @.planning/DESIGN.md @src/lib/agents/scheduledTasks.ts @src/lib/mail/scheduled.ts

**Design:** (frontend task)
- Register: product
- Tokens used: existing token-driven classes only — `.wrap`, `.head`, `.tag`, `.list`, `.item`, `.name`, `.meta`, `.badge` (`ok`/`muted`/`err`), `.btn` (`danger`/`sm`), `.empty`, `.empty-hint`, `.skeleton`/`.skeleton-row`; colors via OKLCH tokens (`--text`, `--text-dim`, `--surface`, `--border`, `--accent`, `--danger`), spacing via `--sp-*`. Metadata/timestamps render in the inherited JetBrains Mono of `.meta`. No `#000`/`#fff`, no Inter/Arial, no ad-hoc hex.
- Scope: page
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/app/tasks/page.tsx` pre-commit (if the tool exists in this repo); commit blocked on critical findings. Reused-class-only constraint means zero new styling primitives.

---

## Task 4 — Ship the PWA manifest + apple-mobile-web-app meta (installs standalone on iOS)
**Wave:** 1
**Persona:** frontend
**Files:**
- CREATE `public/manifest.json`
- CREATE `public/icon-192.png` and `public/icon-512.png` (generated from `src/app/icon.png`)
- MODIFY `src/app/layout.tsx` (extend the `metadata` export with `manifest` + `appleWebApp`)
**Depends on:** none

**Why:** REQ-25 / scope-m6.md:22: Wency asked for the app to "feel like an app." A real PWA manifest + the apple-mobile-web-app meta lets him add the app to his iPhone home screen and launch it standalone (no Safari chrome). Locked decision: static `public/manifest.json` + Next.js Metadata API (`manifest` + `appleWebApp` fields) — NOT a dynamic manifest route. Theme/background colors must come from the maritime DESIGN.md tokens (dark-ocean ground hue 220, teal accent hue 192), not invented hex. Grounding confirmed `src/app/icon.png` is a 256×256 RGBA PNG and `sharp` is installed, so 192/512 icons can be generated cleanly.

**Acceptance Criteria:**
- `public/manifest.json` exists with `name: "Aquavoy"`, `short_name: "Aquavoy"`, `start_url: "/"`, `display: "standalone"`, `background_color` + `theme_color` matching the maritime dark-ocean ground, and an `icons` array referencing `/icon-192.png` (192×192) and `/icon-512.png` (512×512) with `type: "image/png"` and `purpose: "any maskable"`.
- `public/icon-192.png` and `public/icon-512.png` exist at the correct pixel dimensions.
- `src/app/layout.tsx` `metadata` export includes `manifest: "/manifest.json"` and an `appleWebApp` object (`capable: true`, `statusBarStyle: "black-translucent"`, `title: "Aquavoy"`) so Next.js emits `<link rel="manifest">` and the `apple-mobile-web-app-*` meta tags.
- Adding the deployed site to an iOS home screen launches it standalone (full-screen, no Safari address bar).

**Action:**
1. Generate the two icons from the existing 256×256 source. Run (Bash, from project root):
   `node -e "const s=require('sharp');s('src/app/icon.png').resize(192,192).png().toFile('public/icon-192.png');s('src/app/icon.png').resize(512,512).png().toFile('public/icon-512.png');"`
   (512 is an upscale from 256 — accepted for MVP per scope-m6.md:22.)
2. Create `public/manifest.json`. Use hex equivalents of the DESIGN.md OKLCH ground/accent tokens — the maritime dark-ocean ground (`--bg = oklch(0.14 0.015 220)`) is approximately `#0c1116`; the teal accent (`--accent = oklch(0.72 0.14 192)`) is approximately `#34c5c0`. Manifest JSON requires hex/rgb (it cannot consume OKLCH or CSS vars), so these are the documented hex projections of the existing tokens, NOT invented colors:
   ```json
   {
     "name": "Aquavoy",
     "short_name": "Aquavoy",
     "description": "Aquavoy Shipping — AI operations console for files, mail, and finance.",
     "start_url": "/",
     "display": "standalone",
     "background_color": "#0c1116",
     "theme_color": "#0c1116",
     "icons": [
       { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
       { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
     ]
   }
   ```
3. In `src/app/layout.tsx`, extend the existing `metadata: Metadata` export (lines 21–25) — keep `title` and `description`, and ADD:
   ```ts
   manifest: "/manifest.json",
   appleWebApp: {
     capable: true,
     statusBarStyle: "black-translucent",
     title: "Aquavoy",
   },
   ```
   Do not create a `app/manifest.ts` route — the static file + Metadata API is the locked approach.

**Validation:** (builder self-check)
- `test -f public/manifest.json && test -f public/icon-192.png && test -f public/icon-512.png && echo EXISTS` → `EXISTS`
- `node -e "const m=require('./public/manifest.json');if(m.display!=='standalone'||m.start_url!=='/'||!m.icons.length)process.exit(1);console.log('OK')"` → `OK`
- `file public/icon-192.png | grep -q "192 x 192" && file public/icon-512.png | grep -q "512 x 512" && echo SIZED` → `SIZED`
- `grep -E "manifest|appleWebApp" src/app/layout.tsx | wc -l` → ≥ 2
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/layout.tsx @.planning/DESIGN.md

**Design:** (config/layout touching .tsx)
- Register: product
- Tokens used: theme/background colors are the documented hex projections of `--bg` (`oklch(0.14 0.015 220)` → `#0c1116`) and the teal accent `--accent` (hue 192); no invented palette. Manifest format mandates hex, so the OKLCH tokens are projected, not replaced.
- Scope: app
- Anti-pattern guard: builder verifies `background_color`/`theme_color` trace to DESIGN.md tokens; no new color introduced.

---

## Success Criteria
- [ ] `/prep` returns 404; no `/prep` link in Nav, mobile drawer, or Footer; `.prep-grid` styles, the draft API route, and the now-orphaned `src/lib/agents/draftEmail.ts` are deleted; `tsc` confirms no broken import and the agent tool registry is unchanged.
- [ ] `/tasks` renders a merged reminders+scheduled-emails timeline (status, type, mailbox/owner, recurrence) with a working principal-scoped cancel hitting `DELETE /api/tasks/cancel`; both new routes are auth-gated and principal-scoped; the page has loading, error, and empty states.
- [ ] `public/manifest.json` is served (name, `start_url: /`, `display: standalone`, 192/512 icons); `layout.tsx` emits the `manifest` link + apple-mobile-web-app meta; iOS add-to-home-screen launches standalone.

## Verification Contract

### Contract for Task 1 — prep page deleted
**Check type:** command-exit
**Command:** `test ! -e src/app/prep/page.tsx && test ! -e src/app/api/outlook/draft/route.ts && test ! -e src/lib/agents/draftEmail.ts && echo DELETED`
**Expected:** `DELETED`
**Fail if:** Any of the three files still exists

### Contract for Task 1 — prep links removed, tasks links added
**Check type:** command-exit
**Command:** `grep -il "prep" src/components/Nav.tsx src/components/Footer.tsx; grep -c "/tasks" src/components/Nav.tsx; grep -c "/tasks" src/components/Footer.tsx`
**Expected:** No file printed by the first grep; both counts ≥ 1
**Fail if:** Either component still contains "prep", or either lacks a `/tasks` link

### Contract for Task 1 — prep CSS removed, no agent tool break
**Check type:** grep-match
**Command:** `grep -c "prep-grid" src/app/globals.css; grep -rn "draftEmail" src/lib/agents/ | grep -v "draftEmail.ts" | wc -l`
**Expected:** First count `0`; second count `0`
**Fail if:** `.prep-grid` still in globals.css, or any agent tool references `draftEmail`

### Contract for Task 2 — tasks API routes exist + wired to backend
**Check type:** grep-match
**Command:** `test -f src/app/api/tasks/list/route.ts && test -f src/app/api/tasks/cancel/route.ts && grep -E "listTasks|listScheduled" src/app/api/tasks/list/route.ts | wc -l && grep -E "cancelTask|cancelScheduled" src/app/api/tasks/cancel/route.ts | wc -l`
**Expected:** Both files exist; first count ≥ 2; second count ≥ 2
**Fail if:** A route is missing, or a route does not call the existing backend functions

### Contract for Task 2 — routes auth-gated + principal-scoped
**Check type:** grep-match
**Command:** `grep -c "getPrincipal" src/app/api/tasks/list/route.ts; grep -c "getPrincipal" src/app/api/tasks/cancel/route.ts`
**Expected:** Both ≥ 1
**Fail if:** Either route omits `getPrincipal` (unauthenticated access to another operator's queue)

### Contract for Task 3 — /tasks page consumes both routes
**Check type:** grep-match
**Command:** `test -f src/app/tasks/page.tsx && grep -c "/api/tasks/list" src/app/tasks/page.tsx && grep -c "/api/tasks/cancel" src/app/tasks/page.tsx`
**Expected:** File exists; both counts ≥ 1
**Fail if:** Page does not fetch the list or does not call cancel — code exists but isn't wired

### Contract for Task 3 — page has loading + empty states
**Check type:** grep-match
**Command:** `grep -E "skeleton|aria-busy" src/app/tasks/page.tsx | wc -l; grep -c "empty" src/app/tasks/page.tsx`
**Expected:** First ≥ 1; second ≥ 1
**Fail if:** Loading or empty state missing

### Contract for Task 4 — manifest served with required fields
**Check type:** command-exit
**Command:** `node -e "const m=require('./public/manifest.json');if(m.name!=='Aquavoy'||m.display!=='standalone'||m.start_url!=='/'||m.icons.length<2)process.exit(1);console.log('OK')"`
**Expected:** `OK`
**Fail if:** Manifest missing name/standalone/start_url or fewer than 2 icons

### Contract for Task 4 — icons exist at correct sizes
**Check type:** command-exit
**Command:** `file public/icon-192.png | grep -q "192 x 192" && file public/icon-512.png | grep -q "512 x 512" && echo SIZED`
**Expected:** `SIZED`
**Fail if:** Either icon is absent or wrong dimensions

### Contract for Task 4 — layout emits manifest + apple meta
**Check type:** grep-match
**Command:** `grep -E "manifest|appleWebApp" src/app/layout.tsx | wc -l`
**Expected:** ≥ 2
**Fail if:** `metadata` export lacks `manifest` or `appleWebApp`

### Contract for whole phase — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript error
