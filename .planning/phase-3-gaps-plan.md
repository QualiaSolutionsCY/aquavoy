---
phase: 3
type: gap-closure
goal: "Inline sm buttons (action + Retry) render in document flow; the genuine card-corner ✕ stays pinned — no buttons float to the viewport top-right corner at any width."
tasks: 2
waves: 2
gaps_closed: 1
---

# Phase 3 — Gap Closure: `.btn.sm` layout regression

**Goal:** Every `btn sm` action/Retry button sits inline in its container (`.row`, `.empty`, `.notice.err`, `.item` grid cell); the one genuine corner close button (prep ✕) stays pinned in its `.crew-item` corner. No button escapes to `position:absolute; top/right` of the viewport.

**Why this phase:** GAP 1 (HIGH) — `globals.css:324-325` makes `.btn.sm { position: absolute; top; right }`. That was authored ONLY for the prep ✕ inside `.crew-item{position:relative}` (globals.css:1092). Phase 3 (T1) floored `.btn.sm` at 44px and T2/T3/T4 reused `btn sm` for 10 inline buttons whose containers are NOT positioned, so they all float to the viewport top-right and overlap unrelated content. SC2 (error+retry) failed on Wiring=1 because the Retry button is visually unreachable.

**Grounding evidence (verified this session):**
- `globals.css:324-332` — `.btn.sm { position: absolute; top: var(--sp-2); right: var(--sp-2); padding: 0.15rem 0.4rem; font-size: 0.75rem; min-height: 44px; border-radius: var(--radius-sm); }`
- `globals.css:1091-1092` — `.crew-item { position: relative; ... }` — the ONLY positioned ancestor for any `sm` button.
- `globals.css:382` — `.item { display: grid; grid-template-columns: 40px 1fr auto auto; ... }` — NO `position: relative`.
- `globals.css:448,455,467` — `.notice`, `.notice.err`, `.empty` — NO `position: relative`.
- `globals.css:335-340` — `.row { display: flex; ... }` — NO `position: relative`.
- Only glyph close button in the codebase: `prep/page.tsx:255` (`✕`) inside the `<button className="btn danger sm">` opened at `prep/page.tsx:248`, nested in `.crew-item` (`prep/page.tsx:237`). This is the SOLE genuine card-corner pin.
- Scheduled-Cancel `emails/page.tsx:600` is the 3rd cell of an `.item` grid (`gridTemplateColumns: "1fr auto auto"` at `emails/page.tsx:580`) — an INLINE grid cell with text "Cancel", NOT a corner pin → stays `.btn.sm` static.
- All other `sm` buttons (`files:198`, `emails:267,323,331,337,345,368,561,600`, `prep:207`) are inline → stay `.btn.sm` static.

## Task 1 — Split `.btn.close` (absolute corner) out of `.btn.sm` (static size modifier)
**Wave:** 1
**Persona:** frontend
**Files:** `src/app/globals.css` (sole owner — modify the `.btn.sm` rule at lines 324-332, add a new `.btn.close` rule)
**Depends on:** none

**Why:** GAP 1 root cause — the absolute-positioning lives on `.btn.sm`, which is now used as a generic size modifier on 10 inline buttons. Extracting the corner-pin into a dedicated `.btn.close` makes `.btn.sm` a pure, side-effect-free size modifier so inline buttons stay in flow, while preserving the corner-pin behavior for genuine close buttons.

**Acceptance Criteria:**
- `.btn.sm` has `position: static` (or no position declaration that resolves to static) and NO `top`/`right` — it only changes size (compact padding + font-size) and keeps `min-height: 44px` and the small radius.
- A new `.btn.close` rule exists with `position: absolute; top: var(--sp-2); right: var(--sp-2); min-height: 44px` (carrying the corner-pin behavior + the 44px tap-target floor).
- No other selector's behavior changes; the `min-height: 28px` floor is NOT reintroduced anywhere.

**Action:**
1. Edit the `.btn.sm` block at `globals.css:324-332`. Remove `position: absolute;`, `top: var(--sp-2);`, and `right: var(--sp-2);`. Add `position: static;` explicitly (defends against any future cascade). Keep `padding: 0.15rem 0.4rem;`, `font-size: 0.75rem;`, `min-height: 44px;`, `border-radius: var(--radius-sm);`. Result is a pure size modifier with a 44px tap-target floor.
2. Immediately after the `.btn.sm` block, add:
   ```css
   .btn.close {
     position: absolute;
     top: var(--sp-2);
     right: var(--sp-2);
     padding: 0.15rem 0.4rem;
     font-size: 0.75rem;
     min-height: 44px;
     border-radius: var(--radius-sm);
   }
   ```
   This reproduces the OLD `.btn.sm` behavior verbatim (so the prep ✕, once migrated in Task 2, renders byte-identically to today).
3. Do NOT touch `.crew-item` (globals.css:1091) — it already sets `position: relative`, which `.btn.close` needs.

**Validation:** (builder self-check)
- `grep -A8 '^\.btn\.sm {' src/app/globals.css | grep -c 'position: absolute'` → `0`
- `grep -c '^\.btn\.close {' src/app/globals.css` → `1`
- `grep -A8 '^\.btn\.close {' src/app/globals.css | grep -c 'position: absolute'` → `1`
- `grep -c 'min-height: 28px' src/app/globals.css` → `0` (the Phase 3 44px floor stays intact)
- `npm run typecheck` → exit 0 (CSS-only change, must not break the build)

**Context:** Read @src/app/globals.css (lines 305-345 for `.btn` family, 1084-1100 for `.crew-item`), @.planning/DESIGN.md (§2 color, §3 type — reverse-engineered shipped system; do not alter aesthetic)

**Design:**
- Register: product (reverse-engineered shipped ship-console system per DESIGN.md §1)
- Tokens used: `var(--sp-2)`, `var(--radius-sm)` — unchanged from existing rule
- Scope: component (single utility-class split)
- Anti-pattern guard: `bin/slop-detect.mjs` does not exist in this repo (verifier-confirmed tooling gap); builder runs the grep Validation above instead. No new hex/font/spacing introduced — values are copied verbatim from the existing rule.

## Task 2 — Migrate the genuine card-corner button (prep ✕) to `.btn.close`
**Wave:** 2
**Persona:** frontend
**Files:** `src/app/prep/page.tsx` (line 248 — change `className="btn danger sm"` → `className="btn danger close"`)
**Depends on:** Task 1

**Why:** The prep ✕ at `prep/page.tsx:248` is the ONLY button that genuinely relies on absolute corner-pinning — it sits `✕`-style in the top-right of its `.crew-item` card (`.crew-item{position:relative}`, globals.css:1092; card reserves space via `padding-right: var(--sp-7)`, globals.css:1096). After Task 1 makes `.btn.sm` static, this button would collapse inline and break the card layout unless migrated to `.btn.close`. All OTHER `sm` buttons are inline and are CORRECTLY fixed by Task 1 alone — they must NOT be touched.

**Acceptance Criteria:**
- The prep ✕ remove button uses `className="btn danger close"` and stays visually pinned to the top-right corner of its crew-item card.
- No other `sm` button in `prep/page.tsx`, `emails/page.tsx`, or `files/page.tsx` is changed — the 10 inline buttons keep `btn sm` / `btn ghost sm` / `btn danger sm` and now render in flow thanks to Task 1.
- The scheduled-Cancel button (`emails/page.tsx:600`) stays `btn danger sm` (it is an inline `.item` grid cell, not a corner pin).

**Action:**
1. In `src/app/prep/page.tsx`, at the button opened on line 248 (the one whose child glyph is `✕` on line 255, with `aria-label={\`Remove ${r.name}\`}`), change `className="btn danger sm"` to `className="btn danger close"`. This is the single targeted edit.
2. Do NOT modify the Retry button at `prep/page.tsx:207` — it is inline and correctly fixed by Task 1.
3. Do NOT modify any button in `emails/page.tsx` or `files/page.tsx`.

**Validation:** (builder self-check)
- `grep -c 'btn danger close' src/app/prep/page.tsx` → `1`
- `grep -F 'aria-label={`Remove ${r.name}`}' src/app/prep/page.tsx` → matches the line directly below the changed className (confirms the corner ✕ was the one migrated, not the Retry)
- `grep -c 'btn ghost sm' src/app/prep/page.tsx` → `1` (the Retry at line 207 is untouched)
- `grep -c 'btn danger close' src/app/emails/page.tsx src/app/files/page.tsx` → `0` (no inline button wrongly migrated)
- `npm run typecheck` → exit 0

**Context:** Read @src/app/prep/page.tsx (lines 200-258 — the crew error Retry at 207 and the crew-item ✕ at 248), @src/app/globals.css (the `.btn.close` rule added in Task 1)

**Design:**
- Register: product (shipped ship-console system)
- Tokens used: none added — class swap only
- Scope: component (one className)
- Anti-pattern guard: grep Validation above (no slop-detect in repo per verifier).

## Success Criteria
- [ ] `.btn.sm` is a static size modifier in `globals.css` — no `position: absolute`, no `top`/`right`; keeps `min-height: 44px`.
- [ ] `.btn.close` exists in `globals.css` with the absolute corner-pin behavior + `min-height: 44px`.
- [ ] The prep ✕ remove button uses `btn danger close` and stays corner-pinned inside `.crew-item`.
- [ ] All 10 inline `sm` buttons (Re-verify, Connect, Confirm, Cancel disconnect, Disconnect, both Retry on emails, Retry files, Retry crew, scheduled-Cancel) render in document flow — none escape to the viewport top-right.
- [ ] `npm run typecheck` exits 0.

## Verification Contract

### Contract for Task 1 — `.btn.sm` is now static (regression root cause removed)
**Check type:** command-exit
**Command:** `grep -A8 '^\.btn\.sm {' src/app/globals.css | grep -c 'position: absolute'`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — `.btn.sm` still absolutely positioned, inline buttons still escape.

### Contract for Task 1 — `.btn.close` corner-pin rule added
**Check type:** grep-match
**Command:** `grep -A8 '^\.btn\.close {' src/app/globals.css | grep -c 'position: absolute'`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no corner-pin class exists; the prep ✕ has nowhere to anchor.

### Contract for Task 1 — 44px tap floor preserved (Phase 3 SC4 not regressed)
**Check type:** command-exit
**Command:** `grep -c 'min-height: 28px' src/app/globals.css`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — the 28px floor was reintroduced, breaking SC4.

### Contract for Task 2 — prep ✕ migrated to `.btn.close`
**Check type:** grep-match
**Command:** `grep -c 'btn danger close' src/app/prep/page.tsx`
**Expected:** `1`
**Fail if:** Returns 0 (corner button left static → card layout breaks) or ≥ 2 (an inline button wrongly migrated → it floats off).

### Contract for Task 2 — inline buttons NOT migrated (no over-fix)
**Check type:** command-exit
**Command:** `grep -c 'btn danger close' src/app/emails/page.tsx src/app/files/page.tsx | grep -c ':0'`
**Expected:** `2`
**Fail if:** Not 2 — an inline action/Retry button in emails or files was wrongly given `.btn.close` and now floats to the corner.

### Contract for Task 2 — prep Retry stays inline `.btn.sm`
**Check type:** grep-match
**Command:** `grep -c 'btn ghost sm' src/app/prep/page.tsx`
**Expected:** `1`
**Fail if:** Returns 0 — the inline Retry was wrongly migrated to `.btn.close` and now escapes its `.notice.err` container.

### Contract for both tasks — build stays green
**Check type:** command-exit
**Command:** `npm run typecheck`
**Expected:** exit 0
**Fail if:** Any TypeScript error.

### Contract — behavioral (375px layout, verifier confirms when a live authed session is available)
**Check type:** behavioral
**Command:** (manual — load /emails, /files, /prep at 375px viewport width in an authed browser session)
**Expected:** Every action button (Re-verify, Connect, Confirm, Cancel disconnect, Disconnect), every Retry button (emails accounts, emails scheduled, files, prep crew), and the scheduled-Cancel button sit INLINE within their `.row`/`.empty`/`.notice.err`/`.item` containers in normal flow. The prep ✕ remove button stays pinned to the top-right corner of its crew-item card. No button overlaps unrelated content at the viewport's top-right corner.
**Fail if:** Any inline button renders at the page top-right corner, OR the prep ✕ drops inline out of its corner.
**Note:** This is the SAME documented residual recorded in `.planning/phase-3-verification.md` (auth-gated app, no live session in CI). Code-level grep contracts above are the binding gate; this behavioral check is confirmatory when a session exists.
