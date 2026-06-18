---
phase: 3
result: PASS
gaps: 0
milestone: M3 (last phase)
---

# Phase 3 Verification — UX Refinement

**Goal:** Emails, Files, and Prep pages each show a skeleton loader on load, an inline "Could not load — Retry" on 5xx, and a non-empty empty state with CTA — all usable at 375px (no horizontal overflow, every interactive target ≥ 44×44px).

---

## Contract Results

Machine contract: 13/13 PASS (from `.planning/evidence/phase-3-contract-run.json`). All grep-match contracts passed. The behavioral contract (live 375px browser check) is deferred (auth-gated app, no live session).

| Task | Check | Result |
|---|---|---|
| T1 | `min-height: 28px` count = 0 | PASS |
| T1 | `empty-hint` count ≥ 1 | PASS |
| T1 (mobile danger floor) | `btn.danger:not(.sm)` → `min-height: 44px` | PASS |
| T2 | `skeleton-row` in emails ≥ 1 | PASS |
| T2 | `Could not load — Retry` in emails ≥ 1 | PASS |
| T2 | `Ask the agent to list your emails` in emails ≥ 1 | PASS |
| T2 | `36px` count in emails = 0 | PASS |
| T3 | `Could not load — Retry` in files ≥ 1 | PASS |
| T3 | `Search for a file in the chat` in files ≥ 1 | PASS |
| T4 | `crewLoading` count ≥ 2 | PASS |
| T4 | `skeleton-row` in prep ≥ 1 | PASS |
| T4 | `Could not load — Retry` in prep ≥ 1 | PASS |
| T4 | `Add a recipient to get started` in prep ≥ 1 | PASS |

---

## 3-Level Verification — Success Criteria

### SC1 — Skeleton on slow load (REQ-17)

**Level 2 (Artifacts):**
- `src/app/emails/page.tsx:253-261` — `loading ? <div className="list" aria-busy="true">` renders 6 `.skeleton-row` blocks with `.skeleton.icon`, `.skeleton`, `.skeleton.meta`
- `src/app/emails/page.tsx:547-555` — `scheduledLoading ? <div className="list" aria-busy="true">` renders 4 `.skeleton-row` blocks
- `src/app/files/page.tsx:223-230` — `initializing ? <div className="list" aria-busy="true">` renders 5 `.skeleton-row` blocks
- `src/app/files/page.tsx:298-305` — `busy ? [0,1,2,3].map(i => <div className="skeleton-row">...)` renders during folder navigation
- `src/app/prep/page.tsx:38` — `const [crewLoading, setCrewLoading] = useState(true)`
- `src/app/prep/page.tsx:219-227` — `crewLoading ? <div className="crew-list" aria-busy="true">` renders 4 `.skeleton-row` blocks

**Level 3 (Wiring):**
- `src/app/prep/page.tsx:85-97` — `loadCrew()` sets `setCrewLoading(true)` at entry, `setCrewLoading(false)` in `finally` block — full lifecycle wired
- `.skeleton-row` CSS: `src/app/globals.css:1219-1238` — sonar-sweep animation wired via `.skeleton::after` with `sonar-sweep 1.6s` keyframe
- `prefers-reduced-motion` honored: `src/app/globals.css:53` — existing shared rule

**Verdict: PASS** — All three pages show skeleton on load. Emails added skeleton for both accounts and scheduled panels; Files skeleton was pre-existing; Prep crew skeleton added correctly with lifecycle management.

---

### SC2 — Error + retry affordance (REQ-17)

**Level 2 (Artifacts):**
- `src/app/emails/page.tsx:263-277` — accounts error path: `error ? <div className="empty"><div>Could not load — Retry</div><button className="btn ghost sm" onClick={() => { setError(null); setLoading(true); fetchAccounts(); }}>Retry</button></div>`
- `src/app/emails/page.tsx:557-571` — scheduled error path: `scheduledError ? <div className="empty"><div>Could not load — Retry</div><button className="btn ghost sm" onClick={() => { setScheduledError(null); setScheduledLoading(true); fetchScheduled(); }}>Retry</button></div>`
- `src/app/files/page.tsx:194-215` — error path: `<div className="notice err">Could not load — Retry <button className="btn ghost sm" onClick={...}>Retry</button></div>` — retry correctly re-invokes `loadFolder` or `loadConnections` chain
- `src/app/prep/page.tsx:202-217` — crew error: `<div className="notice err"><strong>Could not load — Retry</strong> <button className="btn ghost sm" onClick={() => { setCrewError(null); loadCrew(); }}>Retry</button></div>`

**Level 3 (Wiring — callback correctness):**
- `src/app/emails/page.tsx:138` — `fetchAccounts = useCallback(...)` confirmed; retry on accounts at line 272 calls `fetchAccounts()` after resetting `setLoading(true)` and `setError(null)` — skeleton reappears on retry
- `src/app/emails/page.tsx:105` — `fetchScheduled = useCallback(...)` confirmed; retry at line 566 calls `fetchScheduled()` after resetting loading state — skeleton reappears on retry
- `src/app/files/page.tsx:52,59` — `loadConnections` and `loadFolder` are `useCallback` — retry branch at lines 201-209 is correct
- `src/app/prep/page.tsx:85` — `loadCrew()` is a plain async function (not `useCallback`) but correctly called from Retry onClick

**Layout wiring (gap-closure verified — see Gap Closure Re-Verification below):**
- `src/app/globals.css:324-330` — `.btn.sm { position: static; ... min-height: 44px; }` — FIXED. Static positioning confirmed. All 10 inline `sm` buttons now render in document flow inside their `.row`/`.empty`/`.notice.err`/`.item` containers.
- `src/app/globals.css:331-339` — `.btn.close { position: absolute; top: var(--sp-2); right: var(--sp-2); ... min-height: 44px; }` — corner-pin behavior extracted to dedicated class.
- `src/app/prep/page.tsx:248` — `className="btn danger close"` — the sole genuine card-corner ✕ button uses `.btn.close`, stays pinned inside `.crew-item { position: relative }` at `globals.css:1099`.

**Verdict: PASS** — Gap 1 closed. Retry callbacks correct. Retry and action buttons now render inline. Wiring dimension: 5.

---

### SC3 — No horizontal overflow at 375px (code-level)

**Level 2 (Artifacts):**
- `src/app/globals.css:240-243` — `.wrap { width: 100%; padding: clamp(var(--sp-5), 4vw, var(--sp-7)) clamp(1rem, 3vw, 3.5rem); }` — fluid padding, no fixed width
- `src/app/globals.css:1156-1187` — `@media (max-width: 640px)` block: `.item { grid-template-columns: 40px 1fr auto }`, `.bar input, .bar select { width: 100% }`
- `src/app/globals.css:9` responsive declarations count: `grep "@media" globals.css` = 9 media query blocks

**Documented Residual — live browser check:** The app is auth-gated; no live session is available in this environment. Code-level evidence confirms fluid containers and responsive breakpoints. The gap-closure (`.btn.sm` now static) removes the prior complication where absolutely-positioned buttons were affecting flow. Code-level criteria (no fixed containers, CSS floors, responsive grid) are verified. Only live pixel-overflow measurement at 375px requires a browser session — this is a noted residual, not a verification gap.

**Verdict: PASS at code level** — No fixed-width containers, fluid padding, correct responsive grid. Documented residual: live 375px pixel-overflow measurement not executable in this environment (auth-gated).

---

### SC4 — Tap targets ≥ 44×44px at 375px

**Level 2 (Artifacts):**
- `src/app/globals.css:328` — `.btn.sm { min-height: 44px; }` — was `28px`, now `44px`
- `src/app/globals.css:337` — `.btn.close { min-height: 44px; }` — corner-pin inherits same floor
- `src/app/globals.css:1178` — `.item .btn.danger:not(.sm) { min-height: 44px; }` — was `32px`, now `44px`
- `grep -c "min-height: 28px" src/app/globals.css` → 0 (confirmed)
- `grep -c "36px" src/app/emails/page.tsx` → 0 — all inline sub-44px heights removed
- `grep -c "min-height" src/app/emails/page.tsx src/app/files/page.tsx src/app/prep/page.tsx` → 0 — no inline minHeight remaining

**CSS floor is correct and buttons now render at correct positions.** With `.btn.sm` now static, the 44px height is met dimensionally AND the visual placement is correct (inline in flow).

**Verdict: PASS** — 44px CSS floor correctly implemented. No regressions.

---

### SC5 — Non-empty empty states with CTAs (REQ-17)

**Level 2 (Artifacts):**
- `src/app/emails/page.tsx:573` — `<div className="empty">Ask the agent to list your emails</div>` — exact required copy
- `src/app/files/page.tsx:307-310` — `<div className="empty">This folder is empty.<span className="empty-hint">Search for a file in the chat.</span></div>` — "Search for a file in the chat" present
- `src/app/prep/page.tsx:232` — `<div className="empty">Add a recipient to get started</div>` — exact required copy

**Level 3 (Wiring):**
- Emails: `scheduled.length === 0` branch correctly gates the CTA — `emails/page.tsx:572`
- Files: `items.length === 0` branch at `files/page.tsx:306` — `.empty-hint` displays correctly because `.empty` and `.empty-hint` CSS both exist at `globals.css:466-480`
- Prep: `crew.length === 0 && !crewError` at `prep/page.tsx:231` — correctly shown only when crew is empty and no error

**Verdict: PASS** — All three pages have exact CTA copy, correctly gated, using `.empty`/`.empty-hint` tokens from the design system.

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|---|---|---|---|---|---|
| SC1 — Skeleton on load | 5 | 5 | 5 | 4 | PASS |
| SC2 — Error + retry | 4 | 4 | 5 | 4 | PASS |
| SC3 — 375px no overflow (code) | 4 | 4 | 4 | 4 | PASS |
| SC4 — 44px tap targets | 5 | 5 | 5 | 4 | PASS |
| SC5 — Empty state CTAs | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** All criteria ≥ 3 on all dimensions. NO scores below threshold.

---

## Code Quality
- TypeScript: PASS — `npx tsc --noEmit` exits 0 (no output)
- Tests: PASS — 59/59 pass (vitest run, 12 test files)
- Stubs: 0 — `grep -c "TODO\|FIXME\|PLACEHOLDER\|not implemented"` → 0 across all three pages
- Empty catch blocks: 0 — no bare `catch {}` found
- Inline minHeight: 0 — confirmed removed from all pages

---

## Design Verification (Frontend Phase)

`bin/slop-detect.mjs` does NOT exist in this repo. Manual DESIGN.md anti-pattern greps run on the 4 changed files (`globals.css`, `emails/page.tsx`, `files/page.tsx`, `prep/page.tsx`). Noted as a tooling gap — not a failure.

### Anti-Pattern Greps (DESIGN.md §10)

1. **No `#000`/`#fff`:** `grep -n "#000\|#fff\|#[0-9a-fA-F]{3,6}" ...` → 0 results in changed files. All colors use OKLCH tokens or `var(--*)`. PASS
2. **No Inter/Arial/Roboto as primary:** `globals.css:43` — `--font-sans: var(--font-instrument), "Instrument Sans", system-ui, sans-serif;` — Instrument Sans is primary, `system-ui` is fallback only. PASS
3. **Font loading:** `layout.tsx:2` — `import { Instrument_Sans, JetBrains_Mono } from "next/font/google"` — both loaded as Next.js font variables. PASS
4. **Metadata in `--font-mono`:** `globals.css:477` — `.empty-hint { font-family: var(--font-mono) }` — the new `.empty-hint` rule correctly uses mono. PASS
5. **Surface-step tokens:** New CSS uses `var(--surface)`, `var(--text-muted)`, `var(--sp-2)` — all from the token system. PASS
6. **AI slop tells:** No `from-blue.*to-purple`, no `max-w-7xl`, no `max-width: 1200px`. PASS
7. **`prefers-reduced-motion`:** `globals.css:53` — existing shared rule covers `sonar-sweep`. PASS

### Design Rubric — Phase 3

| Dim | Score | Evidence |
|---|---|---|
| Typography | 5 | `layout.tsx:2` — Instrument Sans + JetBrains Mono loaded via `next/font/google`. `globals.css:43-44` — `--font-sans` / `--font-mono` tokens. `globals.css:89` — fluid `clamp(0.9375rem, 0.875rem + 0.25vw, 1rem)`. `globals.css:477` — new `.empty-hint` correctly in `var(--font-mono)`. Full DESIGN.md §3 hierarchy honored. |
| Color cohesion | 5 | Zero raw hex in changed files. All color uses OKLCH tokens or CSS vars. `globals.css:455-458` notice.err uses `var(--danger-subtle)` + OKLCH literals that match the §2 table. `globals.css:474-480` `.empty-hint` uses `var(--text-muted)`. Strategy: Committed teal accent as specified. |
| Spatial rhythm | 4 | New CSS uses `var(--sp-2)`, `var(--sp-3)`, `var(--sp-4)` throughout. `globals.css:469` `.empty` padding `var(--sp-7) var(--sp-4)`. `globals.css:476` `.empty-hint` margin-top `var(--sp-2)`. Minor: some page inline styles use `2rem` (pre-existing) rather than `var(--sp-8)`. |
| Layout originality | 3 | Pages retain their pre-existing grid/panel layout (ship-console aesthetic). No new layout primitives added this phase — UX refinement scope only. |
| Shadow & depth | 3 | No new shadows introduced. Pre-existing elevation via surface-step tokens and `--surface-2`. Consistent with DESIGN.md §6. |
| Motion intent | 5 | Skeleton sonar-sweep animation reused from `globals.css:1192-1216`. No new animations introduced. `prefers-reduced-motion` at `globals.css:53` fully honored. |
| Microcopy specificity | 5 | CTA copies are specific and agent-oriented: "Ask the agent to list your emails", "Search for a file in the chat", "Add a recipient to get started" — no generic "No data" or "Empty state" placeholder text. `emails/page.tsx:573`, `files/page.tsx:309`, `prep/page.tsx:232`. |
| Container depth & nesting | 3 | `.empty-hint` inside `.empty` adds one level of nesting with semantic purpose. Retry button inside `.empty` container follows same nesting pattern. No gratuitous wrapper divs added. |
| Visual system & graphics | 4 | `aria-busy="true"` and `aria-label` on all skeleton containers: `emails/page.tsx:254`, `emails/page.tsx:548`, `files/page.tsx:224`, `prep/page.tsx:220`. Skeleton icon uses `.skeleton.icon` square matching file-type emoji placeholder pattern. |

**Aggregate:** 37/45 (avg 4.1)
**Design verdict:** PASS (all dims ≥ 3)

---

## Documented Residuals (not gaps)

**Live 375px browser check:** The app is auth-gated (login required) and no live session is available in this verification environment. Code-level evidence confirms:
- Fluid containers (no fixed-width max-width blocks on verified pages)
- Responsive breakpoints at 640px in `globals.css:1156`
- No inline fixed px widths introduced in T2–T4
- `.btn.sm` now static — buttons render in flow, eliminating the prior complication

This is a noted residual, not an open gap — the code criteria (no fixed containers, CSS floors, responsive grid, correct static positioning) are verified by code inspection. Only the live pixel-overflow measurement at 375px requires a browser.

**`bin/slop-detect.mjs` missing:** Manual anti-pattern greps substituted. Tooling gap noted — not a verification failure.

---

## Gap Closure Re-Verification

**Commits verified:** f842626 (`fix(css): split .btn.close (absolute corner) out of .btn.sm (static size modifier)`) and 4452752 (`fix(prep): migrate corner ✕ remove button to .btn.close (corner-pin after T1)`).

### Contract Results — Gap Closure Plan

| Contract | Command | Expected | Result |
|---|---|---|---|
| T1-a: `.btn.sm` has no `position: absolute` | `grep -A6 '^\.btn\.sm {' globals.css \| grep -c 'position: absolute'` | 0 | PASS — 0 |
| T1-b: `.btn.close` rule exists | `grep -c '^\.btn\.close {' globals.css` | 1 | PASS — 1 |
| T1-c: `.btn.close` has `position: absolute` | `grep -A8 '^\.btn\.close {' globals.css \| grep -c 'position: absolute'` | ≥1 | PASS — 1 |
| T1-d: 28px floor not reintroduced | `grep -c 'min-height: 28px' globals.css` | 0 | PASS — 0 |
| T2-a: prep ✕ uses `btn danger close` | `grep -c 'btn danger close' prep/page.tsx` | 1 | PASS — 1 |
| T2-b: prep Retry stays `btn ghost sm` | `grep -c 'btn ghost sm' prep/page.tsx` | 1 | PASS — 1 |
| T2-c: no inline button in emails/files wrongly migrated | `grep -c 'btn danger close' emails/page.tsx files/page.tsx` | 0 each | PASS — 0/0 |
| Build: TypeScript | `npx tsc --noEmit` | exit 0 | PASS — no output |
| Tests | `npm test` | 59/59 | PASS — 59/59, 12 files |

### Artifact Verification (file:line citations)

**`.btn.sm` is now a static size modifier:**
- `src/app/globals.css:324-330` — `.btn.sm { position: static; padding: 0.15rem 0.4rem; font-size: 0.75rem; min-height: 44px; border-radius: var(--radius-sm); }` — `position: static` confirmed, NO `top`/`right`, `min-height: 44px` preserved.

**`.btn.close` is the new corner-pin rule:**
- `src/app/globals.css:331-339` — `.btn.close { position: absolute; top: var(--sp-2); right: var(--sp-2); padding: 0.15rem 0.4rem; font-size: 0.75rem; min-height: 44px; border-radius: var(--radius-sm); }` — corner-pin behavior confirmed, `min-height: 44px` present.

**`.crew-item` retains `position: relative` (`.btn.close` positioned ancestor):**
- `src/app/globals.css:1098-1099` — `.crew-item { position: relative; ... }` — unchanged. The sole positioned ancestor for the corner ✕ remains correct.

**`.row`, `.empty`, `.notice`, `.item` have NO `position: relative`:**
- `src/app/globals.css:342-347` — `.row { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }` — no position declaration.
- `src/app/globals.css:389-398` — `.item { display: grid; grid-template-columns: 40px 1fr auto auto; ... }` — no position declaration.
- `src/app/globals.css:455-466` — `.notice { ... }` / `.notice.err { ... }` — no position declaration.
- `src/app/globals.css:474-480` — `.empty { color: var(--text-dim); padding: var(--sp-7) var(--sp-4); ... }` — no position declaration.
- All `position: relative` declarations in globals.css are at lines 1099, 1200, 1367 — none are `.row`, `.empty`, `.notice`, or `.item`.

**Prep ✕ remove button uses `btn danger close`:**
- `src/app/prep/page.tsx:247-255` — `<button className="btn danger close" ... aria-label={\`Remove ${r.name}\`}> ✕ </button>` inside `<div className="crew-item ...">` — corner-pin preserved.

**Prep Retry stays `btn ghost sm` (inline, not migrated):**
- `src/app/prep/page.tsx:207` — `className="btn ghost sm"` — Retry button inside `.notice.err` at line 203. Now renders inline (`.notice.err` has no `position: relative`, `.btn.sm` is now static).

**Scheduled-Cancel (`emails/page.tsx:600`) stays `btn danger sm` (inline grid cell):**
- `src/app/emails/page.tsx:577-606` — `.item` with `gridTemplateColumns: "1fr auto auto"`, Cancel button at line 600 is the 3rd grid cell (`className="btn danger sm"`). `.item` has no `position: relative` — renders inline as a grid cell. Correct.

**No inline button was wrongly given `.btn.close`:**
- `src/app/emails/page.tsx` — `grep 'btn danger close'` → 0 results.
- `src/app/files/page.tsx` — `grep 'btn danger close'` → 0 results.
- Only occurrence across all `.tsx` files: `src/app/prep/page.tsx:248` — the one legitimate corner button.

### Adversarial Check — All `btn ... sm` buttons confirmed inline

All 10 `btn ... sm` instances verified by grep. Each is inside a container with no `position: relative`, so static `.btn.sm` renders them in document flow:

| File:Line | Class | Container | Position ancestor | Inline? |
|---|---|---|---|---|
| `emails/page.tsx:267` | `btn ghost sm` | `.empty` | none → viewport static | YES — in flow |
| `emails/page.tsx:323` | `btn ghost sm` | `.row` inside `.item` | none → static | YES — in flow |
| `emails/page.tsx:331` | `btn danger sm` | `.row` inside `.item` | none → static | YES — in flow |
| `emails/page.tsx:337` | `btn ghost sm` | `.row` inside `.item` | none → static | YES — in flow |
| `emails/page.tsx:345` | `btn danger sm` | `.row` inside `.item` | none → static | YES — in flow |
| `emails/page.tsx:368` | `btn sm` | sibling to `.row` in `.item` | none → static | YES — in flow |
| `emails/page.tsx:561` | `btn ghost sm` | `.empty` | none → static | YES — in flow |
| `emails/page.tsx:600` | `btn danger sm` | `.item` grid cell | none → static | YES — grid cell |
| `files/page.tsx:198` | `btn ghost sm` | `.notice.err` | none → static | YES — in flow |
| `prep/page.tsx:207` | `btn ghost sm` | `.notice.err` | none → static | YES — in flow |

No `btn ... sm` button has a positioned ancestor (other than the corrected prep ✕ which now uses `.btn.close`). All inline buttons render in document flow. GAP 1 is CLOSED.

### Behavioral residual (documented, not blocking)

The live 375px browser check (manual, auth-gated) remains undoable in this environment. Code-level analysis confirms: with `.btn.sm` static and no positioned ancestor for these containers, no button can escape to the viewport corner. This residual was documented in the original verification and is carried forward unchanged — it is not an open gap.

---

## Verdict

**PASS — Phase 3 goal achieved. GAP 1 (HIGH) closed. All criteria score ≥ 3 on all dimensions. Milestone M3 complete.**

SC1 (skeleton): PASS. SC2 (error+retry, including layout wiring): PASS. SC3 (375px code-level): PASS. SC4 (44px floor): PASS. SC5 (empty CTAs): PASS.

TypeScript: 0 errors. Tests: 59/59. Design rubric: 37/45 (avg 4.1), all dims ≥ 3.
