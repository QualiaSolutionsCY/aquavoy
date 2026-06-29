---
phase: 4
goal: "Capture voyage economics the generic finance ledger can't, AND write the voyage row back into Wency's real Reis registratie.xlsx — both confirm-before-write."
tasks: 4
waves: 3
---

# Phase 4: Voyage finance schema + Excel register

**Goal:** A voyage can be recorded once and land in TWO places, both behind a confirm card: (1) a Supabase `voyage_entries` index row that powers a per-company voyage drill-down on the finance page, and (2) an appended row in the current-year sheet of the real `Reis registratie.xlsx` on OneDrive (existing sheets/columns preserved, file re-uploaded in place).
**Why this phase:** Wency keeps a specialized Excel voyage register (route, tonnage, handler provision, waiting-time, fuel, net/day) the generic `finance_entries` ledger cannot represent (ADR-006); the 2026-06-29 operator note requires the agent to FILL his actual `.xlsx`, not only a parallel DB index. This unlocks the voyage economics views and closes REQ-28.

> **GROUND TRUTH:** the register and its 26 real Dutch columns are documented live at `@.planning/m6-onedrive-discovery.md` (lines 42–80) — this SUPERSEDES the placeholder schema in ADR-006. File: `Reis registratie.xlsx` at OneDrive path `/Documenten/ttt/Bureaublad/Reis registratie.xlsx`, ONE SHEET PER YEAR (sheet names `"2024"`,`"2025"`,`"2026"`).

> **SHARED-FILE WARNING (serialize against Phase 3):** this phase edits four files Phase 3 also edits — `src/lib/agents/onedriveTools.ts` (TOOL_DEFINITIONS + `DESTRUCTIVE` set + a stage branch), `src/lib/agents/executeConfirmedAction.ts` (a new `case`), `src/lib/agents/pendingActions.ts` (a new undo `case`), and `src/app/finance/page.tsx` (`REVERSIBLE_TOOLS`). Phase 4 touches ONLY its own `record_voyage_entry` tool / case / undo branch and adds `record_voyage_entry` to the two sets. Do NOT touch Phase 3's `generate_invoice_from_template` symbol. Mirror the existing `save_email_attachment` pattern exactly (onedriveTools.ts:1131–1187 stage branch; executeConfirmedAction.ts:272–293 case; pendingActions.ts:357–364 undo).

---

## Task 1 — `voyage_entries` migration + `voyageLedger.ts` read/aggregate library
**Wave:** 1
**Persona:** backend
**Files:**
- create `supabase/migrations/0016_voyage_entries.sql` — `public.voyage_entries` table with the 26 real columns, RLS on / no policies.
- create `src/lib/finance/voyageLedger.ts` — exports `recordVoyageEntry(input)`, `deleteVoyageEntry(id)`, `voyageSummary()`, and the row/summary types + `VOYAGE_COMPANIES`.
- create `src/lib/finance/voyageLedger.test.ts` — aggregation unit tests (no DB; test the pure roll-up via injected rows or a mocked `supabaseAdmin`).
**Depends on:** none

**Why:** REQ-28 / ADR-006 — voyage economics (route, tonnage, handler provision −5%, waiting-time days + net/day, fuel + oil cost, port dues) cannot live as nullable columns on `finance_entries` (violates 3NF, bloats every expense row); they get a parallel RLS-gated table. The aggregator mirrors `financeSummary` so the finance page renders per-company voyage totals the same way it renders the ledger.

**Acceptance Criteria:**
- Migration creates `voyage_entries` with: `id uuid pk`, `company text not null` (CHECK against the 8 entities — copy the list from `ledger.ts:25–34`), the 26 register columns (numeric where numeric, text for codes/notes/dates-as-text — see mapping below), `source_ref text`, `created_by text`, `status text not null default 'confirmed'`, `created_at timestamptz default now()`; RLS enabled, NO policies; index on `(company)`.
- `voyageSummary()` returns, for each of the 8 companies (seeded at zero, canonical order), `{ company, voyageCount, revenue, net }` plus a consolidated roll-up — only rows with `status='confirmed'`.
- `recordVoyageEntry(input)` inserts one row, returns `{ id }`; `deleteVoyageEntry(id)` hard-deletes by id (the undo reversal).
- `npx tsc --noEmit` passes; `voyageLedger.test.ts` passes.

**Action:**
1. Write the migration mirroring `supabase/migrations/0015_finance_entries.sql` exactly for the RLS/comment/index shape (read it first). Columns, in register order, mapping Dutch → field (authoritative list `@.planning/m6-onedrive-discovery.md:49–76`):
   - `voyage_no text` (REIS), `charterer text` (BEVRACHTER), `port_from text` (VAN), `port_to text` (NAAR), `load_date text` (BEGIN/LAAD — store as text, Wency's sheet dates are free-form), `discharge_date text` (EIND/LOS), `cargo_type text` (LADING), `tonnage numeric(14,3)` (TONNAGE), `price_per_ton numeric(14,2)` (P/TON), `kwz text` (KWZ — jargon code, text), `total numeric(14,2)` (TOTAAL), `revenue numeric(14,2)` (OPBRENGST), `handler_provision numeric(14,2)` (PROVISIE -5%), `demurrage numeric(14,2)` (LIGGELD), `fuel numeric(14,2)` (GASOLIE), `fuel_price numeric(14,2)` (PRIJS), `oil_cost numeric(14,2)` (OLIE KOSTEN), `port_dues_load numeric(14,2)` (HAVENGELD LAAD), `port_dues_discharge numeric(14,2)` (HAVENGELD LOS), `net numeric(14,2)` (NETTO), `waiting_days numeric(10,2)` (DAGEN), `net_per_day numeric(14,2)` (NETTO P/D), `gmp text` (GMP — jargon, text), `material_cleaned text` (MATERIAAL GEREINIGD), `zhc text` (ZHC — jargon, text), `note text` (OPMERKING REIS). All voyage columns nullable except `company`. Add `constraint voyage_entries_company_check check (company in ( …the 8 entities… ))`.
2. Build `voyageLedger.ts` mirroring `src/lib/finance/ledger.ts`: re-declare `VOYAGE_COMPANIES` (same 8, same order), `round2`, a `voyageSummary()` that seeds all 8 at zero and sums `revenue`/`net` per company + consolidated (defensive `Number()` coercion like `ledger.ts:97`), `recordVoyageEntry(input: RecordVoyageInput)` that validates non-empty `company` and inserts via `supabaseAdmin()`, and `deleteVoyageEntry(id)`. Export `VoyageEntryInput`, `VoyageCompanyTotals`, `VoyageSummary` types. Number coercion: numeric fields accept `number | null`; pass through nulls.
3. Tests: factor the per-company roll-up so a pure function (rows → summary) can be tested without a live DB (e.g. test `voyageSummary` against a stubbed `supabaseAdmin` returning a fixed `data` array — mirror `ledger.test.ts` setup).

**Validation:** (builder self-check)
- `grep -c "enable row level security" supabase/migrations/0016_voyage_entries.sql` → `1`
- `grep -c "create policy\|for select\|for insert" supabase/migrations/0016_voyage_entries.sql` → `0` (service-role only, no policies)
- `grep -c "voyage_entries_company_check" supabase/migrations/0016_voyage_entries.sql` → `1`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `npx vitest run src/lib/finance/voyageLedger.test.ts` → passes

**Context:** Read @.planning/m6-onedrive-discovery.md @.planning/decisions/ADR-006-voyage-economics-storage.md @src/lib/finance/ledger.ts @supabase/migrations/0015_finance_entries.sql @src/lib/finance/ledger.test.ts

---

## Task 2 — `excelRegister.ts` adapter: read + append-row + re-serialize the register
**Wave:** 1
**Persona:** backend
**Files:**
- create `src/lib/finance/excelRegister.ts` — exports `readRegister(buffer)`, `appendVoyageRow(buffer, year, row)`, the column-order constant, and the `VoyageRegisterRow` type.
- create `src/lib/finance/excelRegister.test.ts` — append round-trip test (build a workbook in memory → append → re-read → assert the row is present and existing sheets/rows are intact).
**Depends on:** none

**Why:** The 2026-06-29 operator note requires writing the voyage row back into Wency's actual `.xlsx` — append to the current-year sheet and re-upload, NEVER regenerate the file from scratch (preserve every existing sheet, column, and row). This adapter owns the `xlsx`-lib specifics (the architecture seam) so the confirm path and tests stay vendor-agnostic.

**Acceptance Criteria:**
- `readRegister(buffer)` parses an `.xlsx` Uint8Array/Buffer into `{ sheetNames: string[]; sheets: Record<string, string[][]> }` (per-sheet AOA), so a caller can inspect the per-year sheets.
- `appendVoyageRow(buffer, year, row)` reads the workbook, locates the sheet named exactly `year` (e.g. `"2026"`) — if absent, throws a clear error naming the available sheet names (does NOT silently create one) — appends ONE row (the 26 values in register column order) to the bottom of that sheet, and returns a NEW `.xlsx` buffer (`Uint8Array`/`Buffer`) with all other sheets and the existing rows of the target sheet byte-for-row unchanged.
- The append uses `XLSX.utils.sheet_add_aoa(ws, [values], { origin: -1 })` (append-to-bottom) and re-serializes with `XLSX.write(wb, { type: "buffer", bookType: "xlsx" })`.
- Round-trip test: a workbook with sheets `["2025","2026"]` and 2 data rows in `"2026"` → append → re-read shows 3 data rows in `"2026"`, `"2025"` untouched, sheet order preserved.

**Action:**
1. Use the SAME read call already proven live at `onedriveTools.ts:921–923`: `const XLSX = await import("xlsx"); const wb = XLSX.read(buf, { type: "array" });`. (`xlsx` is already a dependency, v0.20.3 — confirmed.)
2. Define `REGISTER_COLUMNS` as the ordered list of the 26 field keys (voyage_no, charterer, port_from, port_to, load_date, discharge_date, cargo_type, tonnage, price_per_ton, kwz, total, revenue, handler_provision, demurrage, fuel, fuel_price, oil_cost, port_dues_load, port_dues_discharge, net, waiting_days, net_per_day, gmp, material_cleaned, zhc, note) — the SAME order as the migration and the discovery doc. `appendVoyageRow` maps the `VoyageRegisterRow` object to a values array in this order (empty string for null/undefined so cells stay aligned).
3. `readRegister`: for each `wb.SheetNames`, `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })` to get AOA; return the map.
4. `appendVoyageRow`: `const ws = wb.Sheets[year]; if (!ws) throw new Error(\`Register has no sheet named "${year}". Available: ${wb.SheetNames.join(", ")}\`);` then `XLSX.utils.sheet_add_aoa(ws, [values], { origin: -1 });` then `return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });`.
5. Test builds the input workbook with `XLSX.utils.book_new()` + `aoa_to_sheet` + `book_append_sheet`, writes to buffer, then exercises `appendVoyageRow`.

**Validation:** (builder self-check)
- `grep -c "sheet_add_aoa" src/lib/finance/excelRegister.ts` → `1`
- `grep -c "origin: -1\|origin:-1" src/lib/finance/excelRegister.ts` → `1`
- `grep -c "book_new\|aoa_to_sheet" src/lib/finance/excelRegister.ts` → `0` (must NOT rebuild from scratch in the append path)
- `npx vitest run src/lib/finance/excelRegister.test.ts` → passes (round-trip)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @.planning/m6-onedrive-discovery.md @src/lib/agents/onedriveTools.ts (lines 919–932, the existing xlsx read path) @src/lib/microsoft/onedrive.ts (lines 103–135, uploadFile small-PUT overwrite)

---

## Task 3 — `record_voyage_entry` tool: definition, stage, confirm (DB insert + xlsx append/re-upload), undo
**Wave:** 2
**Persona:** backend
**Files:**
- modify `src/lib/agents/onedriveTools.ts` — add `record_voyage_entry` to `TOOL_DEFINITIONS` (after the `record_finance_entry` block, ~line 333), add `"record_voyage_entry"` to the `DESTRUCTIVE` set (~line 992, after `save_email_attachment`), add a `summarizeAction` case, and a stage branch in `executeTool` (mirror the `save_email_attachment` branch at ~1133).
- modify `src/lib/agents/executeConfirmedAction.ts` — add a `case "record_voyage_entry"` (after the `save_email_attachment` case ~line 293) that inserts the DB row AND appends to the register + re-uploads.
- modify `src/lib/agents/pendingActions.ts` — add a `case "record_voyage_entry"` in `undoAction` (after `save_email_attachment` ~line 364).
- modify `src/lib/agents/executeConfirmedAction.test.ts` — add stage→confirm→execute coverage for `record_voyage_entry`.
**Depends on:** Task 1, Task 2

**Why:** REQ-28 / ADR-003 — recording a voyage is a confirm-before-write action that must do TWO writes (the `voyage_entries` index row + the append to Wency's shared `.xlsx`); a wrong parse must never silently book a voyage or corrupt his register. The tool stages a card; both writes happen only on confirm.

**Acceptance Criteria:**
- `record_voyage_entry` appears in `TOOL_DEFINITIONS` with a `company` enum (the 8 entities), a required `year` (string, e.g. `"2026"` — the sheet to append to), required `registerItemId` (the OneDrive item id of `Reis registratie.xlsx`, so the confirm path reads + re-uploads the exact file), and the voyage economic fields (voyage_no, charterer, port_from, port_to, cargo_type, tonnage, revenue, net, etc. — the register fields, all optional except company/year/registerItemId), plus a description string. The tool description states it is CONFIRMED-BEFORE-WRITE and writes to BOTH the finance index AND the Excel register.
- Calling the tool in the model loop STAGES a `pending_actions` row (never writes) and returns `{ status: "confirmation_required", action_id, summary }`. The summary states both effects AND warns the Excel append is NOT auto-reverted on undo (see undo semantics below).
- On confirm: `executeConfirmedAction` (i) inserts via `recordVoyageEntry` (Task 1), (ii) downloads the register file by `registerItemId` (`downloadContent`), appends the row with `appendVoyageRow` (Task 2), re-uploads the buffer to the SAME path/name overwriting the original (`uploadFile` — the file is small, simple-PUT replaces), and returns `undo_data: { voyageEntryId, registerItemId, year, appendedRow: true }`.
- Undo deletes the `voyage_entries` row via `deleteVoyageEntry`; it does NOT auto-revert the xlsx append — it returns `undone: true` with a `reason` noting the register row must be removed manually (mirrors the `delete_item` best-effort pattern, pendingActions.ts:273–282). The confirm-card summary already warned of this.
- `executeConfirmedAction.test.ts` covers: tool name routes to the case; a missing `registerItemId` throws a clear error.

**Action:**
1. **TOOL_DEFINITIONS** (onedriveTools.ts): copy the `record_finance_entry` block shape (lines 273–332). Required: `company` (enum, the 8), `year` (string), `registerItemId` (string). Optional voyage fields matching the `VoyageRegisterRow` keys from Task 2 (`voyage_no`, `charterer`, `port_from`, `port_to`, `load_date`, `discharge_date`, `cargo_type`, `tonnage`, `price_per_ton`, `total`, `revenue`, `handler_provision`, `demurrage`, `fuel`, `fuel_price`, `oil_cost`, `port_dues_load`, `port_dues_discharge`, `net`, `waiting_days`, `net_per_day`, `kwz`, `gmp`, `material_cleaned`, `zhc`, `note`). `additionalProperties: false`. Description: "Record ONE voyage for one of the eight group companies. CONFIRMED BEFORE WRITING — calling it stages a confirmation card; on approval it (1) writes the voyage to the finance index AND (2) appends the row to the current-year sheet of the Reis registratie.xlsx register on OneDrive and re-uploads it. You MUST pass `registerItemId` (the OneDrive item id of Reis registratie.xlsx — find it with search_files first) and `year` (the sheet, e.g. 2026). Note: undo removes the database row but does NOT auto-remove the appended Excel row."
2. **DESTRUCTIVE set:** add `"record_voyage_entry",` after `"save_email_attachment"` (line 992).
3. **summarizeAction:** add a case returning e.g. `Record voyage ${voyage_no||"(no #)"} for ${company} (${port_from}→${port_to}) — index + append to ${year} register; undo removes the DB row only, the Excel row stays`.
4. **Stage branch** in `executeTool` (mirror save_email_attachment ~1133): validate `company` non-empty, `year` non-empty, `registerItemId` non-empty (else return `{ error }`); build the summary; `stagePendingAction({ principal: sessionPrincipal, tool: "record_voyage_entry", args: {…all fields…}, summary })`; return `{ status: "confirmation_required", action_id: row.id, summary }`. (The generic fall-through at line 1189 also works, but add an explicit branch ONLY if you need custom validation — otherwise let it fall through to the generic stage with a `summarizeAction` case. Prefer the generic path: just add the `summarizeAction` case + the DESTRUCTIVE entry; no custom branch needed since there is no stage-time side-effect like batch-move's preview.)
5. **executeConfirmedAction case** (after line 293): read args (`str`/`Number` like the existing cases), `const { id } = await recordVoyageEntry({ company, voyage_no, …, createdBy: principal, sourceRef: registerItemId })`; then `const connId = await resolveConnectionId(); const res = await downloadContent(connId, registerItemId); const buf = new Uint8Array(await res.arrayBuffer()); const newBuf = appendVoyageRow(buf, year, {…the 26 fields…}); const item = await getItem(connId, { itemId: registerItemId }); await uploadFile(connId, { path: item.path }, item.name, newBuf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");` — re-upload by the file's own path+name overwrites it. Return `{ result: { recorded: true, voyageEntryId: id, registerItemId, year }, undo_data: { voyageEntryId: id, registerItemId, year, appendedRow: true } }`. Import `recordVoyageEntry` from `@/lib/finance/voyageLedger`, `appendVoyageRow` from `@/lib/finance/excelRegister`, and add `downloadContent`, `getItem` to the existing `@/lib/microsoft/onedrive` import (uploadFile already imported, line 1–6).
6. **pendingActions undo case** (after line 364): `const entryId = typeof undo.voyageEntryId === "string" ? undo.voyageEntryId : ""; if (!entryId) return { action, undone: false, reason: "voyage entry id unavailable" }; await deleteVoyageEntry(entryId);` then fall through to the `status: "undone"` update. BUT set the success reason to flag the manual Excel cleanup: return `{ action: …undone…, undone: true, reason: "Voyage removed from the finance index. The row appended to Reis registratie.xlsx was NOT auto-removed — delete it manually in Excel." }` (extend the final return at line 380 to carry this reason for this tool, OR break and let the generic success return run — simplest: `break;` and accept the generic `undone:true` with no reason, since the confirm summary already warned). Import `deleteVoyageEntry` from `@/lib/finance/voyageLedger`.
7. Tests in `executeConfirmedAction.test.ts`: mock the onedrive + voyageLedger + excelRegister modules; assert `executeConfirmedAction("record_voyage_entry", args, principal)` calls `recordVoyageEntry` then `appendVoyageRow` then `uploadFile`, and that a missing `registerItemId` throws.

**Validation:** (builder self-check)
- `grep -c "record_voyage_entry" src/lib/agents/onedriveTools.ts` → `≥ 3` (TOOL_DEFINITIONS name + DESTRUCTIVE entry + summarizeAction case)
- `grep -c "record_voyage_entry" src/lib/agents/executeConfirmedAction.ts` → `≥ 1`
- `grep -c "appendVoyageRow\|recordVoyageEntry" src/lib/agents/executeConfirmedAction.ts` → `2`
- `grep -c "record_voyage_entry" src/lib/agents/pendingActions.ts` → `1`
- `grep -c "deleteVoyageEntry" src/lib/agents/pendingActions.ts` → `1`
- `npx vitest run src/lib/agents/executeConfirmedAction.test.ts` → passes
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/agents/onedriveTools.ts (lines 273–333 record_finance_entry def; 976–993 DESTRUCTIVE; 995–1037 summarizeAction; 1131–1201 stage branches) @src/lib/agents/executeConfirmedAction.ts (full — mirror save_email_attachment 272–293) @src/lib/agents/pendingActions.ts (lines 237–382 undoAction) @src/lib/finance/voyageLedger.ts @src/lib/finance/excelRegister.ts @src/lib/microsoft/onedrive.ts @src/lib/agents/executeConfirmedAction.test.ts

---

## Task 4 — Finance page voyage drill-down section + summary API route + REVERSIBLE_TOOLS
**Wave:** 3
**Persona:** frontend
**Files:**
- create `src/app/api/finance/voyages/route.ts` — `GET` returning `voyageSummary()`, principal-gated (mirror `src/app/api/finance/summary/route.ts`).
- modify `src/app/finance/page.tsx` — add `"record_voyage_entry"` to `REVERSIBLE_TOOLS` (~line 61), and add a per-company voyage drill-down section (new component) fed by `/api/finance/voyages`, placed after the existing `fin-overview` section.
**Depends on:** Task 1, Task 3

**Why:** ADR-006 — the voyage economics need to be visible per company on the finance page (Wency asked to "integrate this into the finance page"); and the new tool must show an Undo affordance, which requires it in `REVERSIBLE_TOOLS` (the page hides Undo for tools not in the set — see line 57–70).

**Acceptance Criteria:**
- `GET /api/finance/voyages` returns `{ ok: true, data: { companies: [{company, voyageCount, revenue, net}], consolidated: {...} } }`, 401 when unauthenticated (copy `summary/route.ts` exactly, swap `financeSummary` → `voyageSummary`).
- The finance page renders a "Voyage economics" section: per-company cards (8, canonical order) each showing voyage count, total revenue, and net, plus a consolidated header — with loading (skeleton), error (retry), and empty ("No voyages recorded yet") states. Reuses the existing finance CSS classes (`fin-overview`, `fin-company-grid`, `fin-company-card`, `fin-stat`, `fin-net-pos/neg/zero`, `panel-h`, `formatMoney`, `netClass`, `num`) — NO new hardcoded colors or fonts.
- `record_voyage_entry` is in `REVERSIBLE_TOOLS`, so a confirmed voyage card shows the Undo button.
- Works at 375px and 1440px (the existing `fin-company-grid` is already responsive — reuse it).

**Action:**
1. Add `"record_voyage_entry",` to the `REVERSIBLE_TOOLS` set (finance/page.tsx:61–70).
2. Create the API route by copying `src/app/api/finance/summary/route.ts` verbatim and swapping the import + call to `voyageSummary` from `@/lib/finance/voyageLedger`. Path: `src/app/api/finance/voyages/route.ts`.
3. In `finance/page.tsx`, add a `VoyageOverview` section component mirroring the existing `FinanceOverview` render (the `fin-overview` block at ~670–780): load `/api/finance/voyages` on mount (same fetch/401-redirect pattern as `loadSummary`, lines 221–240), render consolidated revenue/net `fin-stat`s + a `fin-company-grid` of `fin-company-card`s showing `{voyageCount} voyages`, `formatMoney(revenue)`, and `formatMoney(net)` with `netClass(net)`. Include skeleton-loading, error-with-retry, and empty states copied from the existing overview (lines 686–728). Place `<VoyageOverview />` directly after the existing financial-overview section in the page's JSX. Use only existing classes + the existing `formatMoney`/`netClass`/`num` helpers.
4. Do NOT alter Phase 3's symbols or the existing `FinanceOverview` — append the new section.

**Validation:** (builder self-check)
- `grep -c "record_voyage_entry" src/app/finance/page.tsx` → `1`
- `grep -c "voyageSummary" src/app/api/finance/voyages/route.ts` → `1`
- `grep -c "#[0-9a-fA-F]\{3,6\}" src/app/finance/page.tsx` → unchanged from before this task (no new hex colors — diff the count; new section uses class names only)
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/finance/voyages` (dev server, unauthenticated) → `401`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/finance/page.tsx (lines 57–70 REVERSIBLE_TOOLS; 134–170 helpers; 220–240 loadSummary; 660–808 the FinanceOverview render to mirror) @src/app/api/finance/summary/route.ts @src/lib/finance/voyageLedger.ts @.planning/DESIGN.md

**Design:** (frontend task)
- Register: product (maritime operations console — existing shipped system)
- Tokens used: existing finance CSS classes only — `fin-overview`, `fin-overview-head`, `fin-consolidated`, `fin-company-grid`, `fin-company-card`, `fin-stat`, `fin-stat-label`, `fin-stat-value`, `fin-net-pos`, `fin-net-neg`, `fin-net-zero`, `panel-h`, `skeleton`, `empty`, `btn ghost sm`. No new CSS variables, no new hex colors, no new fonts.
- Scope: section (one new section appended to the finance page)
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/app/finance/page.tsx` pre-commit; commit blocked on critical findings.

---

## Success Criteria
- [ ] `voyage_entries` table exists with the 26 real register columns + the 8-company CHECK, RLS on / no policies (verified: `enable row level security` present, `create policy` count = 0).
- [ ] A voyage recorded via the agent is CONFIRMED-BEFORE-WRITE: staging it writes nothing; on confirm it inserts a `voyage_entries` row AND appends a row to the matching year-sheet of `Reis registratie.xlsx`, re-uploaded in place with all existing sheets/rows preserved.
- [ ] Undo of a confirmed voyage deletes the DB row and surfaces that the Excel append is not auto-reverted.
- [ ] The finance page shows a per-company voyage economics drill-down (count + revenue + net) with loading/error/empty states, reusing the existing finance design tokens.
- [ ] `npx tsc --noEmit` passes; all new tests (`voyageLedger.test.ts`, `excelRegister.test.ts` round-trip, `executeConfirmedAction.test.ts` additions) pass.

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0016_voyage_entries.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — RLS on, no policies (constitution + ADR-006)
**Check type:** command-exit
**Command:** `grep -c "enable row level security" supabase/migrations/0016_voyage_entries.sql; grep -c "create policy" supabase/migrations/0016_voyage_entries.sql`
**Expected:** first line `1`, second line `0`
**Fail if:** RLS not enabled, or any public policy exists (service-role-only is required)

### Contract for Task 1 — 8-company CHECK present
**Check type:** grep-match
**Command:** `grep -c "voyage_entries_company_check" supabase/migrations/0016_voyage_entries.sql`
**Expected:** `1`
**Fail if:** Returns 0 — company is not constrained to the eight entities

### Contract for Task 1 — voyageLedger aggregator + tests
**Check type:** command-exit
**Command:** `npx vitest run src/lib/finance/voyageLedger.test.ts`
**Expected:** test run passes
**Fail if:** any test fails or the file is absent

### Contract for Task 2 — append-in-place, not rebuild
**Check type:** grep-match
**Command:** `grep -c "sheet_add_aoa" src/lib/finance/excelRegister.ts; grep -c "origin: -1\|origin:-1" src/lib/finance/excelRegister.ts`
**Expected:** both `1`
**Fail if:** the append does not use `sheet_add_aoa` with `origin: -1` (would not append to the existing sheet's bottom)

### Contract for Task 2 — round-trip preserves existing sheets
**Check type:** command-exit
**Command:** `npx vitest run src/lib/finance/excelRegister.test.ts`
**Expected:** test run passes (3 rows after appending to a 2-row sheet; other sheet untouched)
**Fail if:** the round-trip test fails

### Contract for Task 3 — tool registered + destructive + staged
**Check type:** grep-match
**Command:** `grep -c "record_voyage_entry" src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 3 — TOOL_DEFINITIONS, DESTRUCTIVE set, summarizeAction)
**Fail if:** Returns < 3 — tool missing from definitions, the destructive gate, or the summary

### Contract for Task 3 — confirm path does both writes
**Check type:** grep-match
**Command:** `grep -c "recordVoyageEntry" src/lib/agents/executeConfirmedAction.ts; grep -c "appendVoyageRow" src/lib/agents/executeConfirmedAction.ts; grep -c "uploadFile" src/lib/agents/executeConfirmedAction.ts`
**Expected:** all ≥ 1
**Fail if:** the confirm case does not insert the DB row AND append+re-upload the register

### Contract for Task 3 — undo deletes the DB row
**Check type:** grep-match
**Command:** `grep -c "deleteVoyageEntry" src/lib/agents/pendingActions.ts`
**Expected:** `1`
**Fail if:** Returns 0 — the voyage undo does not reverse the index insert

### Contract for Task 3 — confirm/execute test
**Check type:** command-exit
**Command:** `npx vitest run src/lib/agents/executeConfirmedAction.test.ts`
**Expected:** test run passes
**Fail if:** the record_voyage_entry confirm coverage fails

### Contract for Task 4 — voyages API route gated
**Check type:** grep-match
**Command:** `grep -c "voyageSummary" src/app/api/finance/voyages/route.ts; grep -c "getPrincipal\|401" src/app/api/finance/voyages/route.ts`
**Expected:** both ≥ 1
**Fail if:** route does not call voyageSummary or is not principal-gated

### Contract for Task 4 — tool is reversible in the UI
**Check type:** grep-match
**Command:** `grep -c "record_voyage_entry" src/app/finance/page.tsx`
**Expected:** `1`
**Fail if:** Returns 0 — the confirmed voyage card would not show an Undo affordance

### Contract for Task 4 — no new hardcoded colors (design)
**Check type:** command-exit
**Command:** `node bin/slop-detect.mjs src/app/finance/page.tsx`
**Expected:** no critical findings
**Fail if:** the new section introduces hardcoded hex colors / off-system tokens

### Contract — whole project compiles
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** any TypeScript error
