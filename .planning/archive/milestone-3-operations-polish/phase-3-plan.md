---
phase: 3
goal: "Emails, Files, and Prep pages get complete UI state coverage (loading skeleton, error with retry, empty state with CTA) and pass a mobile layout check at 375px"
tasks: 4
waves: 2
---

# Phase 3: UX Refinement

**Goal:** The Emails, Files, and Prep management pages each show a skeleton loader while data is in-flight, an inline "Could not load — Retry" on fetch failure, and a non-empty empty state with a call-to-action — and all three are usable at 375px (no horizontal overflow, every interactive target ≥ 44×44px).
**Why this phase:** Operators run the back office from a phone or a slow Dutch-office connection; a blank screen on slow load or a 5xx is the single most common "the tool is broken" report. This closes REQ-17 and REQ-18 and the last open M3 exit criterion.

---

## Task 1 — Fix touch-target floors and add empty-CTA helper in globals.css
**Wave:** 1
**Persona:** frontend
**Files:** `src/app/globals.css` (modify — sole owner of this file this phase)
**Depends on:** none

**Why:** REQ-18 / success criterion 4 requires every interactive target ≥ 44×44px at 375px, but three shipped rules violate it: `.btn.sm` is `min-height: 28px` (globals.css:330), the mobile delete override `.item .btn.danger:not(.sm)` drops to `min-height: 32px` (globals.css:1171), and the inline `minHeight: "36px"` buttons on the Emails page rely on the class system being correct. Centralizing the fix here (the sole owner of globals.css this phase) keeps the three page tasks free of write-conflicts so they can run in parallel in Wave 2.

**Acceptance Criteria:**
- `.btn.sm` resolves to a computed height ≥ 44px at 375px width (it is used by the Cancel buttons in Emails scheduled rows and the ✕ remove button in Prep crew).
- The mobile-only `.item .btn.danger:not(.sm)` override no longer sets a height below 44px — at 375px the Files page Delete button is ≥ 44px.
- A reusable empty-state CTA affordance exists: extend `.empty` so it can hold a short prompt plus an emphasized action phrase without ad-hoc inline styles. Add `.empty .empty-hint` (mono, dimmer) for the secondary line if a page needs two lines.
- No new color literals: no `#000`/`#fff`; any new color uses existing OKLCH tokens (`var(--accent)`, `var(--text-dim)`, `var(--text-muted)`).

**Action:**
1. Edit `.btn.sm` (globals.css:324–330): change `min-height: 28px` to `min-height: 44px`. Keep the smaller font/padding (`font-size`, `padding`) so it still reads as a small button, but the tap area meets the floor. If the visual height must stay compact, instead keep `min-height: 44px` and reduce vertical padding — the computed box must be ≥ 44px.
2. Edit the mobile override block at globals.css:1162–1172 (`@media (max-width: 640px) { .item .btn.danger:not(.sm) { … min-height: 32px } }`): change `min-height: 32px` to `min-height: 44px`. The Delete button on the Files page must stay tappable on mobile, not shrink below the floor.
3. Add an `.empty-hint` rule under the existing `.empty` block (globals.css:467–473): `.empty .empty-hint { display: block; margin-top: var(--sp-2); font-family: var(--font-mono); font-size: 0.8125rem; color: var(--text-muted); }`. This lets each page render `<div className="empty">Prompt<span className="empty-hint">…</span></div>` with mono secondary copy matching the design system.
4. Do NOT touch any other selector. Do NOT alter the `.skeleton` / `.skeleton-row` / `sonar-sweep` rules (globals.css:1185–1234) — they are already correct and the page tasks reuse them as-is.

**Validation:** (builder self-check)
- `grep -n "min-height: 28px" src/app/globals.css` → returns nothing (the .btn.sm 28px floor is gone).
- `grep -c "min-height: 44px" src/app/globals.css` → count increased vs. before (the two edited rules now read 44px).
- `grep -n "empty-hint" src/app/globals.css` → returns the new rule.
- `npx tsc --noEmit` → exits 0 (no TS regression; CSS-only change should not affect this, run as a guard).

**Context:** Read @src/app/globals.css (lines 269–473 for buttons/notices/empty; 1146–1234 for responsive + skeletons) and @.planning/DESIGN.md (§4 spacing tokens, §10 anti-pattern checklist).

**Design:**
- Register: product
- Tokens used: `var(--sp-2)`, `var(--font-mono)`, `var(--text-muted)`, `--radius` (unchanged), 44px touch floor
- Scope: app (shared stylesheet)
- Anti-pattern guard: builder runs a manual DESIGN.md anti-pattern audit before commit (no `#000`/`#fff`; fonts via `--font-*` vars only; new color via OKLCH `--*` tokens; metadata copy in JetBrains Mono via `--font-mono`; every interactive target ≥ 44px). `bin/slop-detect.mjs` does not exist in this repo — do not invoke it.

---

## Task 2 — Emails page: skeleton, inline error+retry, empty CTAs, 375px fixes
**Wave:** 2
**Persona:** frontend
**Files:** `src/app/emails/page.tsx` (modify)
**Depends on:** Task 1

**Why:** REQ-17 + success criteria 1, 2, 5: the Emails page currently shows a bare text "Loading accounts…" on load (emails/page.tsx:254) instead of a skeleton, renders the fetch error as a notice with NO retry affordance (emails/page.tsx:250), and the scheduled-emails empty copy is "No scheduled emails yet." (emails/page.tsx:536) rather than the agent-oriented CTA. The inline `minHeight: "36px"` buttons (emails/page.tsx:301,310,317,326,350) also undercut the 44px floor.

**Acceptance Criteria:**
- On slow load, the accounts region shows the `.skeleton-row` sonar-sweep skeleton (not the text "Loading accounts…") until `loading` is false — visible under Chrome DevTools Slow 3G before data arrives.
- When `/api/mail/accounts` or `/api/mail/scheduled` returns a 5xx, the affected region shows an inline "Could not load — Retry" message with a working Retry button that re-runs the corresponding fetch; no blank region and no unhandled console error.
- The scheduled-emails empty state reads "Ask the agent to list your emails" (the page's REQ-17 empty copy) instead of "No scheduled emails yet."
- At 375px there is no horizontal overflow and every button (Connect / Re-verify / Disconnect / Confirm / Cancel / scheduled-Cancel) has a tap area ≥ 44×44px.

**Action:**
1. Replace the accounts loading branch (emails/page.tsx:253–254, `{loading ? (<div className="empty">Loading accounts…</div>)`) with a `.list` of 6 `.skeleton-row` blocks mirroring the Files page pattern at files/page.tsx:206–214 (`<span className="skeleton icon" /><span className="skeleton" style={{ width: … }} /><span className="skeleton meta" />`).
2. Add a retry affordance to the accounts error: when `error` is set, render the notice as "Could not load — Retry" with a `<button className="btn ghost sm" onClick={() => { setError(null); setLoading(true); fetchAccounts(); }}>Retry</button>`. `fetchAccounts` is already a `useCallback` (emails/page.tsx:138). Reset `loading` to true before re-fetch so the skeleton reappears.
3. Add the same retry pattern to the scheduled-emails error block (emails/page.tsx:529–531): button calls `() => { setScheduledError(null); setScheduledLoading(true); fetchScheduled(); }`. `fetchScheduled` is already a `useCallback` (emails/page.tsx:105).
4. Change the scheduled empty copy (emails/page.tsx:536) from "No scheduled emails yet." to "Ask the agent to list your emails" wrapped in `.empty`.
5. Remove the inline `minHeight: "36px"` from the Re-verify / Disconnect / Confirm / Cancel buttons (emails/page.tsx:301,310,317,326) and the Connect button (emails/page.tsx:350); replace those buttons' classes so they use `btn`/`btn ghost`/`btn danger` plus `sm` where compact — `.btn.sm` now floors at 44px from Task 1. Drop the `minHeight: "36px"` style key entirely; keep `fontSize`/`padding` only if still desired.
6. Verify the scheduled-row Cancel button uses `btn danger sm` (already does at emails/page.tsx:563) — no change needed there beyond Task 1's CSS floor.

**Validation:** (builder self-check)
- `grep -c "skeleton-row" src/app/emails/page.tsx` → ≥ 1.
- `grep -c "Could not load — Retry" src/app/emails/page.tsx` → ≥ 1 (present for at least the accounts region; scheduled may reuse the same string).
- `grep -c "Ask the agent to list your emails" src/app/emails/page.tsx` → 1.
- `grep -c "36px" src/app/emails/page.tsx` → 0 (all sub-44px inline button heights removed).
- `npx tsc --noEmit` → exits 0.

**Context:** Read @src/app/emails/page.tsx (full file), @src/app/files/page.tsx (lines 206–219 for the skeleton + empty pattern to copy), @src/app/globals.css (lines 1185–1234 skeletons, 324–330 .btn.sm, 466–473 .empty), and @.planning/DESIGN.md (§5 components, §7 sonar-sweep motion, §10 anti-patterns).

**Design:**
- Register: product
- Tokens used: `.skeleton`/`.skeleton-row` (sonar-sweep), `.notice.err`, `.empty` + `.empty-hint`, `.btn`/`.btn.ghost`/`.btn.danger`/`.btn.sm`, `var(--sp-*)`
- Scope: page
- Anti-pattern guard: manual DESIGN.md anti-pattern audit before commit (no `#000`/`#fff`; reuse existing `.skeleton`/`.notice`/`.empty` classes, do not invent new skeleton aesthetics; metadata stays in `--font-mono`; all buttons ≥ 44px; `prefers-reduced-motion` already honored by the shared sonar-sweep rule). `bin/slop-detect.mjs` does not exist — do not invoke it.

---

## Task 3 — Files page: add error retry + align empty copy, confirm 375px
**Wave:** 2
**Persona:** frontend
**Files:** `src/app/files/page.tsx` (modify)
**Depends on:** Task 1

**Why:** REQ-17 + success criteria 2, 5: the Files page already ships the skeleton (files/page.tsx:206–214, 280–287) and an error notice (files/page.tsx:194–198), but the error has NO retry affordance — a 5xx from `/api/onedrive/files` leaves the operator stuck with a dead error banner. The empty copy "Upload a file or create a folder to get started." (files/page.tsx:288–291) is not the REQ-17 page CTA, which is "Search for a file in the chat."

**Acceptance Criteria:**
- When `/api/onedrive/connections` or `/api/onedrive/files` returns a 5xx, the page shows an inline "Could not load — Retry" message with a working Retry button that re-runs the failed load (re-fetches connections+folder, or the current folder); no blank region, no unhandled console error.
- The folder empty state includes the REQ-17 CTA copy "Search for a file in the chat" (the empty container is never blank).
- At 375px there is no horizontal overflow on the file list, and the Delete button tap area is ≥ 44×44px (relies on Task 1's `:not(.sm)` floor fix).
- The existing skeleton on initial load and on folder navigation (`busy`) still renders unchanged.

**Action:**
1. Add a Retry button to the error notice (files/page.tsx:194–198). Change the notice content to "Could not load — Retry" plus `<button className="btn ghost sm" onClick={() => { setError(null); if (activeConn) { loadFolder(activeConn, currentFolderId); } else { loadConnections().then((list) => list[0]?.id && loadFolder(list[0].id)).catch((e) => setError((e as Error).message)); } }}>Retry</button>`. `loadFolder` (files/page.tsx:59) and `loadConnections` (files/page.tsx:52) are existing `useCallback`s; `currentFolderId` is at files/page.tsx:50.
2. Update the folder empty state (files/page.tsx:288–291) to keep its current sentence but append the CTA line using the Task-1 helper: `<div className="empty">This folder is empty.<span className="empty-hint">Search for a file in the chat.</span></div>`. The literal phrase "Search for a file in the chat" must be present (success criterion 5).
3. Do NOT change the skeleton blocks (files/page.tsx:206–214, 280–287) — they are correct and are the reference pattern for Task 2.
4. Confirm no inline button height below 44px is introduced; the Delete button (files/page.tsx:342–349) uses `btn danger` and is governed by Task 1's mobile floor fix.

**Validation:** (builder self-check)
- `grep -c "Could not load — Retry" src/app/files/page.tsx` → ≥ 1.
- `grep -c "Search for a file in the chat" src/app/files/page.tsx` → 1.
- `grep -c "skeleton-row" src/app/files/page.tsx` → ≥ 1 (existing skeleton preserved).
- `npx tsc --noEmit` → exits 0.

**Context:** Read @src/app/files/page.tsx (full file), @src/app/globals.css (lines 466–473 .empty + new .empty-hint, 1162–1172 mobile delete floor, 1185–1234 skeletons), and @.planning/DESIGN.md (§5, §9 responsive, §10 anti-patterns).

**Design:**
- Register: product
- Tokens used: `.notice.err`, `.empty` + `.empty-hint`, `.btn.ghost.sm`, `.skeleton-row` (unchanged), `var(--sp-*)`
- Scope: page
- Anti-pattern guard: manual DESIGN.md anti-pattern audit before commit (no `#000`/`#fff`; reuse `.notice`/`.empty`/`.skeleton-row`; metadata in `--font-mono`; Delete button ≥ 44px at 375px). `bin/slop-detect.mjs` does not exist — do not invoke it.

---

## Task 4 — Prep page: crew skeleton, error retry, empty CTA, 375px fixes
**Wave:** 2
**Persona:** frontend
**Files:** `src/app/prep/page.tsx` (modify)
**Depends on:** Task 1

**Why:** REQ-17 + success criteria 1, 2, 5: the Prep page's `loadCrew` (prep/page.tsx:84–93) has NO loading flag, so the crew list flashes blank then populates with no skeleton; `crewError` renders as a notice with NO retry (prep/page.tsx:198); and the empty copy "No recipients yet. Add one below." (prep/page.tsx:201) is not the REQ-17 CTA "Add a recipient to get started." The ✕ remove button uses `btn danger sm` (prep/page.tsx:217), governed by Task 1's 44px floor.

**Acceptance Criteria:**
- On slow load, the Crew panel shows `.skeleton-row` sonar-sweep skeletons until the crew fetch resolves — not a blank panel.
- When `/api/recipients` returns a 5xx, the Crew panel shows an inline "Could not load — Retry" message with a working Retry button that re-runs `loadCrew`; no blank panel, no unhandled console error.
- The crew empty state reads "Add a recipient to get started" (REQ-17 page CTA) instead of "No recipients yet. Add one below."
- At 375px the `.prep-grid` stacks to one column (already handled by globals.css:1054–1058) with no horizontal overflow, and the ✕ remove button tap area is ≥ 44×44px (Task 1 floor).

**Action:**
1. Add a `crewLoading` state: `const [crewLoading, setCrewLoading] = useState(true);` near the other crew state (prep/page.tsx:37–41). In `loadCrew` (prep/page.tsx:84–93) set `setCrewLoading(true)` at the start and `setCrewLoading(false)` in a `finally` block.
2. In the Crew panel render (prep/page.tsx:199–229), branch on `crewLoading` FIRST: while loading, render a `.crew-list` containing 4 `.skeleton-row` blocks (`<span className="skeleton icon" /><span className="skeleton" /><span className="skeleton meta" />`), mirroring files/page.tsx:206–214. Only when not loading fall through to the existing empty/crew-list logic.
3. Add a Retry button to the `crewError` notice (prep/page.tsx:198): render "Could not load — Retry" plus `<button className="btn ghost sm" onClick={() => { setCrewError(null); loadCrew(); }}>Retry</button>`. Keep the existing Supabase-config hint as secondary text if `crewError` is set.
4. Change the crew empty copy (prep/page.tsx:201) from "No recipients yet. Add one below." to "Add a recipient to get started" inside `.empty`.
5. The ✕ remove button (prep/page.tsx:217) keeps `btn danger sm`; no inline height — Task 1 floors `.btn.sm` at 44px.

**Validation:** (builder self-check)
- `grep -c "crewLoading" src/app/prep/page.tsx` → ≥ 2 (state declared + used in render).
- `grep -c "skeleton-row" src/app/prep/page.tsx` → ≥ 1.
- `grep -c "Could not load — Retry" src/app/prep/page.tsx` → ≥ 1.
- `grep -c "Add a recipient to get started" src/app/prep/page.tsx` → 1.
- `npx tsc --noEmit` → exits 0.

**Context:** Read @src/app/prep/page.tsx (full file), @src/app/files/page.tsx (lines 206–214 skeleton pattern), @src/app/globals.css (lines 466–473 .empty, 324–330 .btn.sm, 1048–1116 prep-grid/crew, 1185–1234 skeletons), and @.planning/DESIGN.md (§5, §7, §9, §10).

**Design:**
- Register: product
- Tokens used: `.skeleton-row` (sonar-sweep), `.notice.err`, `.empty` + `.empty-hint`, `.btn.ghost.sm`/`.btn.danger.sm`, `.prep-grid`/`.crew-list`/`.crew-item`, `var(--sp-*)`
- Scope: page
- Anti-pattern guard: manual DESIGN.md anti-pattern audit before commit (no `#000`/`#fff`; reuse `.skeleton-row`/`.notice`/`.empty`; metadata in `--font-mono`; ✕ button ≥ 44px; reduced-motion already honored). `bin/slop-detect.mjs` does not exist — do not invoke it.

---

## Success Criteria
- [ ] On a throttled (Slow 3G) connection, each of the three pages shows a skeleton/placeholder immediately on load before data arrives. (T2 accounts skeleton, T3 existing skeleton, T4 crew skeleton)
- [ ] When the backing API returns a 5xx, the affected section shows an inline "Could not load — Retry" message — no blank section, no unhandled JS error. (T2, T3, T4)
- [ ] At 375px viewport width, no page content overflows horizontally on any of the three pages. (T2 inline-button cleanup, T3/T4 existing responsive + T1)
- [ ] All interactive elements on the three pages have a tap target ≥ 44×44px at 375px. (T1 `.btn.sm` + mobile `:not(.sm)` floor; T2 removes 36px inline heights)
- [ ] Each page has a non-empty empty state with its CTA: Emails "Ask the agent to list your emails" (T2), Files "Search for a file in the chat" (T3), Prep "Add a recipient to get started" (T4).

---

## Verification Contract

### Contract for Task 1 — touch-target floors (.btn.sm 44px)
**Check type:** grep-match
**Command:** `grep -c "min-height: 28px" src/app/globals.css`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — the sub-44px `.btn.sm` floor still exists.

### Contract for Task 1 — empty-hint helper added
**Check type:** grep-match
**Command:** `grep -c "empty-hint" src/app/globals.css`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the reusable empty-CTA helper was not added.

### Contract for Task 1 — mobile delete floor raised
**Check type:** command-exit
**Command:** `grep -A3 -F "btn.danger:not(.sm)" src/app/globals.css | grep -q "min-height: 44px"`
**Expected:** exit 0
**Fail if:** Non-zero exit — the mobile `.item .btn.danger:not(.sm)` override still drops below 44px.

### Contract for Task 2 — Emails skeleton present
**Check type:** grep-match
**Command:** `grep -c "skeleton-row" src/app/emails/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — accounts loading still renders bare text, no skeleton.

### Contract for Task 2 — Emails retry affordance
**Check type:** grep-match
**Command:** `grep -c "Could not load — Retry" src/app/emails/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — error has no retry affordance.

### Contract for Task 2 — Emails empty CTA copy
**Check type:** grep-match
**Command:** `grep -c "Ask the agent to list your emails" src/app/emails/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — REQ-17 empty CTA copy missing.

### Contract for Task 2 — Emails sub-44px inline heights removed
**Check type:** grep-match
**Command:** `grep -c "36px" src/app/emails/page.tsx`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — an inline button height below the 44px floor remains.

### Contract for Task 3 — Files retry affordance
**Check type:** grep-match
**Command:** `grep -c "Could not load — Retry" src/app/files/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the Files error notice still has no retry button.

### Contract for Task 3 — Files empty CTA copy
**Check type:** grep-match
**Command:** `grep -c "Search for a file in the chat" src/app/files/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — REQ-17 empty CTA copy missing.

### Contract for Task 4 — Prep crew loading state
**Check type:** grep-match
**Command:** `grep -c "crewLoading" src/app/prep/page.tsx`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns < 2 — loading state not declared and used.

### Contract for Task 4 — Prep skeleton present
**Check type:** grep-match
**Command:** `grep -c "skeleton-row" src/app/prep/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — crew panel still flashes blank, no skeleton.

### Contract for Task 4 — Prep retry affordance
**Check type:** grep-match
**Command:** `grep -c "Could not load — Retry" src/app/prep/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — crewError has no retry button.

### Contract for Task 4 — Prep empty CTA copy
**Check type:** grep-match
**Command:** `grep -c "Add a recipient to get started" src/app/prep/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — REQ-17 empty CTA copy missing.

### Contract for all tasks — TypeScript compiles
**Check type:** command-exit
**Command:** `npx tsc --noEmit`
**Expected:** exit 0
**Fail if:** Any TypeScript compilation error.

### Contract for Phase 3 — 375px layout (behavioral)
**Check type:** behavioral
**Command:** (manual verification by verifier — Chrome DevTools at 375px width on /emails, /files, /prep)
**Expected:** No horizontal scrollbar on any of the three pages; every button/link/input computes ≥ 44×44px; each page's empty state shows its CTA copy; a simulated 5xx shows "Could not load — Retry" with a working button.
**Fail if:** Horizontal overflow appears, any interactive target is < 44px, an empty container is blank, or a 5xx leaves a dead error banner with no retry.
