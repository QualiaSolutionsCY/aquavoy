---
phase: 4
goal: "Make bulk mail cleanup fast — search by sender, then batch-move matching messages to trash or a named folder, behind the existing confirm/undo gate; plus polish recipient autocomplete."
tasks: 3
waves: 2
---

# Phase 4: Batch Email Actions

**Goal:** The agent can search a mailbox by sender and, behind the existing confirm/undo gate, move every matching message to trash or to a named folder in one batch — with the count + a sample shown on the confirm card before anything moves, and undo that puts the messages back. Recipient autocomplete is polished.
**Why this phase:** This is the milestone's FIRST mail *write* surface. It turns the read-only inbox (M5 P2) into a cleanup tool while preserving the M2/ADR-003 destructive-action contract: nothing mutates the mailbox without a human confirming the exact scope.

---

## Task 1 — IMAP move adapter + sender-match preview
**Wave:** 1
**Persona:** backend
**Files:** `src/lib/mail/imap.ts` (modify — add exports), `src/lib/mail/imap.test.ts` (modify — add cases)
**Depends on:** none

**Why:** The batch tools (Task 2) need two new IMAP capabilities the current read-only adapter lacks: (a) resolve which messages match a sender so the confirm card can show a real count + sample BEFORE the move, and (b) actually move a set of UIDs to a destination folder and reverse it. `src/lib/mail/imap.ts` is the ONLY file that may import `imapflow` (imap.ts:14-19 — "the ONLY file in the project that imports imapflow"), so the write must live here behind the same `withClient` connection seam as the read ops.

**Acceptance Criteria:**
- A new `previewSenderMatches(email, folderHint, from, sampleSize)` returns `{ folderPath, total, sample }` where `total` is the count of messages in the resolved folder whose sender matches `from`, and `sample` is up to `sampleSize` envelope summaries (`{ uid, date, from, subject }`) — newest first.
- A new `moveMessages(email, sourceFolderHint, uids, destFolderHint)` opens the source folder read-WRITE, moves exactly those `uids` to the resolved destination folder, and returns `{ movedCount, destFolderPath, uidMap }` where `uidMap` maps each source UID to its new UID in the destination (from imapflow's `messageMove` `CopyResponseObject.uidMap`, present when the server supports UIDPLUS — imap-flow.js:2741, 2783).
- A `resolveTrashFolder(email)` (or `moveMessages` accepting the `"trash"` hint) routes to the mailbox's `\Trash` special-use folder using the existing `resolveFolder` logic (imap.ts:86-177), so "move to trash" is just a move to the resolved Trash path.
- The seam test mocks `imapflow` (no socket opened, same pattern as imap.test.ts:63-68) and asserts: `previewSenderMatches` returns the matched count + sample; `moveMessages` calls `client.messageMove(uidRange, destPath, { uid: true })` with the right destination and returns the `uidMap`.

**Action:**
1. In `imap.ts`, add `export interface SenderMatchPreview { folderPath: string; total: number; sample: EmailSummary[] }` and `export interface MoveResult { movedCount: number; destFolderPath: string; uidMap: Record<number, number> }`.
2. `previewSenderMatches(email, folderHint, from, sampleSize = 5)`: reuse `withClient`; open the resolved folder `{ readOnly: true }`; run `client.search({ from }, { uid: true })` to get matching UIDs; `total = uids.length`; fetch the last `sampleSize` UIDs' envelopes (mirror the fetch+sort in `searchEmails` imap.ts:384-398); return `{ folderPath, total, sample }`. Return `{ folderPath, total: 0, sample: [] }` when no match.
3. `moveMessages(email, sourceFolderHint, uids, destFolderHint)`: reuse `withClient`; resolve BOTH folders via `fetchFolderList` + `resolveFolder`; guard `uids.length > 0`; `await client.mailboxOpen(sourcePath)` (read-write — omit the `{ readOnly: true }` the read ops pass at imap.ts:257/296/366); call `const res = await client.messageMove(uids.join(","), destPath, { uid: true })`; build `uidMap` from `res.uidMap` (a `Map`) via `Object.fromEntries(res.uidMap ?? [])`; return `{ movedCount: uids.length, destFolderPath: destPath, uidMap }`.
4. Add the new exported function types to the fake client in `imap.test.ts`'s `makeFakeClient` (add a `messageMove: vi.fn(async () => ({ uidMap: new Map([[11, 101],[12, 102]]) }))`), and add two `it(...)` cases per the Acceptance Criteria.

**Validation:** (builder self-check)
- `npx vitest run src/lib/mail/imap.test.ts` → all pass, including the two new cases
- `grep -c "messageMove" src/lib/mail/imap.ts` → ≥ 1
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0

**Context:** Read @src/lib/mail/imap.ts @src/lib/mail/imap.test.ts @src/lib/mail/accounts.ts @node_modules/imapflow/lib/imap-flow.js (lines 2735-2790 — `messageMove` / `CopyResponseObject.uidMap`)

---

## Task 2 — Batch move-to-trash / move-to-folder agent tools (confirm-gated, undoable)
**Wave:** 2
**Persona:** backend
**Files:** `src/lib/agents/onedriveTools.ts` (modify — add 2 tool defs, DESTRUCTIVE entries, stage-time summary+args capture), `src/lib/agents/executeConfirmedAction.ts` (modify — add 2 cases), `src/lib/agents/pendingActions.ts` (modify — add 2 undo cases), `src/lib/openrouter/client.ts` (modify — describe the tools in the catalogue), `src/app/page.tsx` (modify — add tools to `REVERSIBLE_TOOLS`), `src/app/finance/page.tsx` (modify — add tools to `REVERSIBLE_TOOLS`)
**Depends on:** Task 1

**Why:** Success criteria 1, 2, 3, and 5 all live here. The two batch tools must (a) capture the matched message set at STAGE time so the confirm card shows count + sample, not a blind action (criterion 3), (b) route through the existing `DESTRUCTIVE` Set → `stagePendingAction` gate exactly like `record_finance_entry` (onedriveTools.ts:842-851, 909-924) so no write occurs without confirmation (criterion 5), and (c) be reversible — trash→restore, folder-move→move-back (criteria 1, 2). The undo path is a `switch` on `action.tool` in `pendingActions.ts:249-312` (there is NO `REVERSIBLE_TOOLS` constant in the agents layer — that Set lives in the page components at page.tsx:62 and finance/page.tsx:61 and only governs whether the UI shows the Undo button).

**Acceptance Criteria:**
- Two new tools registered in `TOOL_DEFINITIONS` (onedriveTools.ts:55): `batch_move_to_trash` (params: `mailbox`, `from`, optional `folder` defaulting to inbox) and `batch_move_to_folder` (params: `mailbox`, `from`, `destFolder`, optional `folder`). Both are in the `DESTRUCTIVE` Set (onedriveTools.ts:842).
- When the agent calls either tool, `executeTool` (within the `DESTRUCTIVE` branch) FIRST calls `previewSenderMatches` to resolve the matched UIDs + count + sample, then stages a `pending_actions` row whose `summary` reads e.g. `Move 23 emails from billing@acme.com in info@aquavoy.com → Trash (incl. "Invoice 4471", "Reminder", "Statement")` and whose `args` include the captured `mailbox`, `sourceFolderPath`, `uids[]`, and `destFolderPath` — so the confirmed action moves exactly the previewed set, not a re-search that could drift.
- On confirm, `executeConfirmedAction` moves every captured UID via `moveMessages` and stores `undo_data = { mailbox, destFolderPath, sourceFolderPath, uidMap }`.
- Undo (`pendingActions.undoAction`) moves the messages back: for each destination UID in `uidMap`, `moveMessages(mailbox, destFolderPath, destUids, sourceFolderPath)`; row moves to `undone`.
- `REVERSIBLE_TOOLS` in BOTH `src/app/page.tsx:62` and `src/app/finance/page.tsx:61` includes `batch_move_to_trash` and `batch_move_to_folder`, so the confirm card shows the Undo button after confirmation.
- The OpenRouter system-prompt catalogue (client.ts:108-109 lists the destructive tools; section 5/6 describe mail + file org) names the two batch tools as confirm-staged: the agent proposes the batch, calls the tool ONCE, and relays the returned `summary`; it does NOT re-call after the user confirms.
- A zero-match search stages NO action and returns a readable "no messages from <sender>" result to the model (so the model tells the user nothing matched instead of showing an empty confirm card).

**Action:**
1. In `onedriveTools.ts`, add the two tool definitions to `TOOL_DEFINITIONS` near the mailbox tools (after `generate_inbox_briefing`, ~line 700). `batch_move_to_folder.destFolder` description: "Target folder name/hint, e.g. 'Archive' or an explicit IMAP path." Add both names to the `DESTRUCTIVE` Set (onedriveTools.ts:842) — these are mail writes.
2. In `executeTool`, the `DESTRUCTIVE` branch currently stages generically (onedriveTools.ts:909-924). Special-case the two batch tools BEFORE the generic `stagePendingAction`: resolve `mailbox`/`from`/folder from `args`, call `previewSenderMatches`; if `total === 0` return `JSON.stringify({ status: "no_match", message: "No emails from <from> in <folder>." })` WITHOUT staging; otherwise build `destFolderPath` (trash via `resolveTrashFolder` for `batch_move_to_trash`, or resolve `destFolder` for `batch_move_to_folder`), collect the matched `uids` (use the full match set, not just the sample — extend `previewSenderMatches` to also return all `uids`, or add a sibling that returns them), compose the `summary` (count + destination + up to 3 sample subjects), then call `stagePendingAction({ principal: sessionPrincipal, tool: name, args: { mailbox, sourceFolderPath, uids, destFolderPath, from }, summary })` and return `{ status: "confirmation_required", action_id, summary }`. Keep the existing `if (!sessionPrincipal) return ... "no verified principal"` guard (onedriveTools.ts:910).
3. Add a `summarizeAction` case is NOT needed because the summary is built at stage time for these tools; but if any path reaches `summarizeAction` (onedriveTools.ts:854) for these names, return a sane fallback string.
4. In `executeConfirmedAction.ts`, add `case "batch_move_to_trash":` and `case "batch_move_to_folder":` (import `moveMessages` from `@/lib/mail/imap`). Read `mailbox`, `sourceFolderPath`, `uids`, `destFolderPath` from `args`; validate `uids` is a non-empty number array; call `moveMessages(mailbox, sourceFolderPath, uids, destFolderPath)`; return `{ result: { moved: res.movedCount, destFolderPath }, undo_data: { mailbox, sourceFolderPath, destFolderPath, uidMap: res.uidMap } }`.
5. In `pendingActions.ts` `undoAction` switch (pendingActions.ts:249), add both cases (import `moveMessages`): read `undo.uidMap` (a `Record<number,number>`), `undo.mailbox`, `undo.sourceFolderPath`, `undo.destFolderPath`; collect `destUids = Object.values(uidMap)`; if empty return `{ action, undone: false, reason: "no moved messages to restore" }`; call `moveMessages(mailbox, destFolderPath, destUids, sourceFolderPath)`; `break` so the row flips to `undone`.
6. In `client.ts`, extend the system-prompt catalogue: in the mail section list `batch_move_to_trash` / `batch_move_to_folder` as confirm-staged writes (mirror the wording for `move_item` at client.ts:142-149), and add both names to the destructive-tools enumeration at client.ts:108-109.
7. In `src/app/page.tsx:62` and `src/app/finance/page.tsx:61`, add `"batch_move_to_trash", "batch_move_to_folder"` to each `REVERSIBLE_TOOLS` Set.

**Validation:** (builder self-check)
- `grep -c "batch_move_to_trash\|batch_move_to_folder" src/lib/agents/onedriveTools.ts` → ≥ 4 (2 tool defs + 2 DESTRUCTIVE entries)
- `grep -c "batch_move_to_trash" src/lib/agents/executeConfirmedAction.ts src/lib/agents/pendingActions.ts` → each ≥ 1
- `grep -c "batch_move_to_trash" src/app/page.tsx src/app/finance/page.tsx` → each ≥ 1
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0
- `grep -rc "TODO\|FIXME\|placeholder\|not implemented" src/lib/agents/onedriveTools.ts src/lib/agents/executeConfirmedAction.ts src/lib/agents/pendingActions.ts` → 0 in the touched regions

**Context:** Read @src/lib/agents/onedriveTools.ts @src/lib/agents/executeConfirmedAction.ts @src/lib/agents/pendingActions.ts @src/lib/openrouter/client.ts @src/app/page.tsx @src/app/finance/page.tsx @.planning/decisions/ADR-003-enforced-confirm-undo.md
**Note (migration drift — see MEMORY):** This phase adds NO new table — undo state rides the existing `pending_actions.undo_data` JSON column (pendingActions.ts:36, 0010_pending_actions.sql). No migration to apply to prod.

---

## Task 3 — Recipient autocomplete polish
**Wave:** 1
**Persona:** frontend
**Files:** `src/components/RecipientAutocomplete.tsx` (modify), `src/app/page.tsx` (modify — composer wiring around line 929-940 only if needed)
**Depends on:** none

**Why:** Success criterion 4 — autocomplete must suggest known recipients *responsively* while composing. The component already exists and is wired into the chat composer (page.tsx:16, 934) with a 150ms debounce, keyboard nav, and stale-response guarding (RecipientAutocomplete.tsx:68-98). The gaps that make it feel unresponsive: it shows NO state while the fetch is in flight (the dropdown only appears after results arrive, so fast typers see nothing), it shows nothing when a valid-looking token returns zero matches (operator can't tell "no match" from "not searched"), and it never reopens the dropdown on focus when there ARE prior results for the current token. Polish = make the suggestion behavior legible, not rebuild it.

**Acceptance Criteria:**
- While a debounced fetch for the current address token is in flight, the dropdown shows a loading affordance (a `sonar-sweep`-style skeleton row or a "Searching…" mono label, per DESIGN.md §7 motion) instead of staying blank — so a fast typer sees the component is working.
- When the token is address-like (`looksLikeAddress`, RecipientAutocomplete.tsx:32-34) but returns zero matches, the dropdown shows a single non-selectable "No matching recipients" row (mono, `--text-muted`), distinct from the closed state.
- Selecting a suggestion, Arrow/Enter/Escape keyboard nav, and the stale-response guard (`reqId`, RecipientAutocomplete.tsx:61,70,84) continue to work unchanged — no regression.
- The new states use the existing design tokens already in the component's styled-jsx (`--surface-3`, `--text-muted`, `--font-mono`, `--accent-subtle`, `--sp-*`, `--radius*`) — no new hardcoded colors, no Inter/system-ui.
- Loading and empty rows have correct ARIA: they are NOT `role="option"` (not selectable), the listbox still announces correctly, and `aria-activedescendant` only ever points at a real suggestion.

**Action:**
1. Add an `isLoading` state to `RecipientAutocomplete`. Set it `true` synchronously when a valid `looksLikeAddress` token starts a debounce window; set `false` in the fetch resolve/catch (guarded by the same `myReq !== reqId.current` stale check, RecipientAutocomplete.tsx:84).
2. Drive `open` so the dropdown is visible when `isLoading` OR `items.length > 0` OR (token is address-like AND a completed fetch returned zero). Render: a skeleton/"Searching…" row while `isLoading`; the existing `items` list when present; a single muted "No matching recipients" `<li aria-disabled="true">` (NOT `role="option"`) when a fetch completed with zero matches for a still-address-like token.
3. Keep `choose`, `onKeyDown`, the pointer-outside close (RecipientAutocomplete.tsx:101-111), and `onSelect` exactly as-is. Ensure `active`/`aria-activedescendant` never indexes the loading/empty rows.
4. Add styled-jsx rules for `.ra-loading` and `.ra-empty` reusing the tokens already in the `<style jsx>` block (RecipientAutocomplete.tsx:197-284); use the app's `sonar-sweep` animation name if adding a skeleton (DESIGN.md §7) and gate it behind `@media (prefers-reduced-motion: reduce)` to a static state.

**Validation:** (builder self-check)
- `grep -c "isLoading\|Searching\|No matching" src/components/RecipientAutocomplete.tsx` → ≥ 2
- `grep -c "Inter\|system-ui\|#[0-9a-fA-F]\{3,6\}" src/components/RecipientAutocomplete.tsx` → 0 (no hardcoded hex, no banned fonts)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0
- `node bin/slop-detect.mjs src/components/RecipientAutocomplete.tsx` → no critical findings (if `bin/slop-detect.mjs` exists; skip if absent)

**Context:** Read @src/components/RecipientAutocomplete.tsx @src/app/page.tsx @src/lib/recipients.ts @src/app/api/recipients/route.ts @.planning/DESIGN.md

**Design:**
- Register: product
- Tokens used: `var(--surface-3)`, `var(--text-muted)`, `var(--text)`, `var(--accent-subtle)`, `var(--border)`, `--sp-1`/`--sp-2`/`--sp-3`, `--radius-sm`, `--font-mono`, `--transition-fast`; `sonar-sweep` animation for the loading skeleton
- Scope: component
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/components/RecipientAutocomplete.tsx` pre-commit; commit blocked on critical findings

---

## Success Criteria
- [ ] "Move all email from <sender> to trash" produces a confirmable batch that, on confirm, moves every matching message to trash; undo restores them. (Tasks 1+2)
- [ ] Moving matching mail to a named folder works the same way — search → confirm → batch move. (Tasks 1+2)
- [ ] The confirm card shows the batch BEFORE it runs (count + sample subjects), so the operator confirms scope, not a blind action. (Task 2, stage-time summary)
- [ ] Recipient autocomplete suggests known recipients responsively while composing — visible loading + no-match states. (Task 3)
- [ ] No mailbox write occurs without passing through the `DESTRUCTIVE` → `stagePendingAction` → confirm gate, consistent with the M2/ADR-003 contract. (Task 2)

## Verification Contract

### Contract for Task 1 — IMAP move adapter
**Check type:** grep-match
**Command:** `grep -c "export async function moveMessages\|export async function previewSenderMatches" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Either function is missing — the batch tools have no write/preview seam to call.

### Contract for Task 1 — move uses messageMove with uid range
**Check type:** grep-match
**Command:** `grep -c "messageMove" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the move is not implemented against the imapflow MOVE command.

### Contract for Task 1 — seam test passes
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/imap.test.ts 2>&1 | grep -c "FAIL\|failed"`
**Expected:** `0`
**Fail if:** Any test in the IMAP seam suite fails.

### Contract for Task 1 — previewSenderMatches called in onedriveTools (adapter seam honored)
**Check type:** grep-match
**Command:** `grep -c "previewSenderMatches" src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the batch-tool preview step bypasses the imap.ts seam (imapflow leaked out of its only-importer).

### Contract for Task 1 — moveMessages imported in both confirm + undo paths
**Check type:** grep-match
**Command:** `grep -lc "moveMessages" src/lib/agents/executeConfirmedAction.ts src/lib/agents/pendingActions.ts | grep -c agents`
**Expected:** `2` (both files import/call it)
**Fail if:** Either file omits `moveMessages` — imapflow move logic was inlined instead of routed through the imap.ts adapter (architecture.md §3 seam violation).

### Contract for Task 2 — batch tools registered + destructive
**Check type:** grep-match
**Command:** `grep -c "batch_move_to_trash\|batch_move_to_folder" src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 4 — 2 tool defs + 2 DESTRUCTIVE entries)
**Fail if:** Fewer than 4 — a tool is undefined or not gated as destructive (criterion 5 violation).

### Contract for Task 2 — confirmed side-effect wired
**Check type:** grep-match
**Command:** `grep -c "batch_move_to_trash\|batch_move_to_folder" src/lib/agents/executeConfirmedAction.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — staged batch moves have no execute path, so confirm does nothing.

### Contract for Task 2 — undo wired
**Check type:** grep-match
**Command:** `grep -c "batch_move_to_trash\|batch_move_to_folder" src/lib/agents/pendingActions.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — undo has no case, so criteria 1/2 (undo restores) fail.

### Contract for Task 2 — confirm card shows Undo (reversible in BOTH page components)
**Check type:** grep-match
**Command:** `grep -lc "batch_move_to_trash" src/app/page.tsx src/app/finance/page.tsx | grep -c page`
**Expected:** Both files match
**Fail if:** Either page omits the batch tools from `REVERSIBLE_TOOLS` — the Undo button won't render even though the action is reversible.

### Contract for Task 2 — system prompt names the tools as confirm-staged
**Check type:** grep-match
**Command:** `grep -c "batch_move_to_trash\|batch_move_to_folder" src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the agent isn't told the tools exist / are staged, so it won't use them correctly.

### Contract for Task 2 — no new migration leaked
**Check type:** command-exit
**Command:** `ls supabase/migrations/ | grep -c "batch\|move_email\|0016"`
**Expected:** `0`
**Fail if:** A migration was added — undo state must ride the existing `pending_actions.undo_data` column, no new table this phase.

### Contract for Task 3 — loading + empty states present
**Check type:** grep-match
**Command:** `grep -c "isLoading\|No matching\|Searching" src/components/RecipientAutocomplete.tsx`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — the autocomplete still has no in-flight/no-match feedback (criterion 4 unmet).

### Contract for Task 3 — no hardcoded color or banned font
**Check type:** command-exit
**Command:** `grep -Ec "Inter|system-ui|#[0-9a-fA-F]{3,6}" src/components/RecipientAutocomplete.tsx`
**Expected:** `0`
**Fail if:** Any hardcoded hex or banned primary font appears — design contract violation.

### Contract for whole phase — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript error across the touched files.

### Contract for whole phase — behavioral (verifier, manual or browser QA)
**Check type:** behavioral
**Command:** (manual) Ask the agent "move all email from <a known sender> to trash" against a connected test mailbox.
**Expected:** A confirm card appears showing the count + sample subjects; clicking Confirm moves them to Trash; the Undo button appears and restores them to the source folder.
**Fail if:** The move runs without a confirm card, the card shows no count/sample, or Undo does not restore the messages.
