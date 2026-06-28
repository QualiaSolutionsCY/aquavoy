---
phase: 2
goal: "Build the save_email_attachment agent tool: extract an email's PDF attachment via IMAP and upload it to OneDrive, staged for confirmation (ADR-003) and undoable."
tasks: 4
waves: 2
---

# Phase 2 (Milestone 6): Attachment → OneDrive

**Goal:** The agent can move a PDF invoice / credit note from a mailbox to a OneDrive folder via a new `save_email_attachment` tool that is CONFIRM-BEFORE-WRITE (ADR-003) and undoable — the missing foundation of invoice automation.
**Why this phase:** Today the agent reads mail (`onedriveTools.ts:1321 read_email`) and reads drive files (`onedriveTools.ts:1113 read_file`) but has no path to carry an attachment from one to the other; this phase builds that bridge.

---

## Task 1 — IMAP attachment extraction (`downloadAttachment` + `readEmail` attachments[])
**Wave:** 1
**Persona:** backend
**Files:**
- `src/lib/mail/imap.ts` (modify) — add `attachments: AttachmentInfo[]` to the `EmailDetail` interface + its return; add `interface AttachmentInfo`; add+export `async function downloadAttachment(email, folderHint, uid, filename): Promise<DownloadedAttachment>` and `interface DownloadedAttachment`.
- `src/lib/mail/imap.test.ts` (modify) — extend the mailparser mock with an `attachments` array; add tests for `readEmail` attachment metadata and `downloadAttachment`.

**Depends on:** none

**Why:** `executeConfirmedAction` (Task 3) must fetch the attachment BYTES at confirm time, and the agent must SEE which attachments an email has to call the tool — both need IMAP to expose attachments. Per locked decision, bytes are downloaded at confirm time, so `readEmail` exposes only metadata and `downloadAttachment` exposes the bytes.

**Acceptance Criteria:**
- `readEmail()` returns an `attachments` array; each entry has `filename` (string), `contentType` (string), and `size` (number) — and NO `content` bytes (metadata only).
- A new exported `downloadAttachment(mailbox, folder, uid, filename)` returns `{ filename, contentType, bytes }` where `bytes` is a `Uint8Array` of the matching attachment.
- `downloadAttachment` throws a readable error (`Attachment "X" not found on message <uid>`) when no attachment matches the filename.
- No regression: existing `imap.test.ts` cases (listFolders, listEmails, readEmail body, searchEmails, moveMessages) still pass.

**Action:**
1. In `imap.ts`, add `export interface AttachmentInfo { filename: string; contentType: string; size: number; }` and add `attachments: AttachmentInfo[]` to `EmailDetail` (currently `imap.ts:218-226`).
2. In `readEmail` (`imap.ts:302`), after `const parsed = await simpleParser(source)` (`imap.ts:322`), map `parsed.attachments` — mailparser v3.9.9 yields objects with `filename`, `contentType`, `content` (Buffer), `size` — to `AttachmentInfo` (drop `content`; default a missing `filename` to `attachment-${i}` and a missing `size` to `content?.length ?? 0`). Add `attachments` to the returned object (`imap.ts:353-361`).
3. Add `export interface DownloadedAttachment { filename: string; contentType: string; bytes: Uint8Array; }`.
4. Add `export async function downloadAttachment(email: string, folderHint: string | undefined, uid: number, filename: string): Promise<DownloadedAttachment>` using the SAME `withClient` + `resolveFolder` + read-only `mailboxOpen` + full-message `client.download(String(uid), undefined, { uid: true })` + `simpleParser` flow as `readEmail` (`imap.ts:307-322`). From `parsed.attachments`, find the entry whose `filename === filename` (fall back to a case-insensitive trim match); if none, `throw new Error(\`Attachment "${filename}" not found on message ${uid}\`)`. Return `{ filename: att.filename ?? filename, contentType: att.contentType ?? "application/octet-stream", bytes: new Uint8Array(att.content) }`.
5. In `imap.test.ts`, change the `mailparser` mock (`imap.test.ts:74-84`) so `simpleParser` resolves with an `attachments` array, e.g. `attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-fake"), size: 9 }]`. Add: (a) a test that `readEmail(...)` returns `attachments` of length 1 with `{ filename: "invoice.pdf", contentType: "application/pdf", size: 9 }` and that the entry has no `content` key; (b) a test that `downloadAttachment("info@aquavoy.com","inbox",11,"invoice.pdf")` returns `contentType: "application/pdf"` and `bytes instanceof Uint8Array` with `bytes.length === 9`; (c) a test that `downloadAttachment(...,"missing.pdf")` rejects with `/not found/`.

**Validation:** (builder self-check)
- `npx vitest run src/lib/mail/imap.test.ts` → all pass
- `grep -c "downloadAttachment\|AttachmentInfo\|DownloadedAttachment" src/lib/mail/imap.ts` → ≥ 3
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0

**Context:** Read @src/lib/mail/imap.ts @src/lib/mail/imap.test.ts @.planning/scope-m6.md @.planning/decisions/ADR-003-enforced-confirm-undo.md

---

## Task 2 — `save_email_attachment` tool definition + DESTRUCTIVE registration + stage path + summary
**Wave:** 1
**Persona:** backend
**Files:**
- `src/lib/agents/onedriveTools.ts` (modify) — add the tool to `TOOL_DEFINITIONS`; add `"save_email_attachment"` to the `DESTRUCTIVE` set (`onedriveTools.ts:929`); add a `save_email_attachment` case to `summarizeAction` (`onedriveTools.ts:946`); add a stage-time validation branch in the `DESTRUCTIVE` block of `executeTool` (alongside the batch-move branch at `onedriveTools.ts:1009`).

**Depends on:** none

**Why:** ADR-003 enforcement is the DESTRUCTIVE-set gate, not the prompt: the tool must have NO code path to the upload inside the model loop. Registering it in `DESTRUCTIVE` routes it through `stagePendingAction` and returns `confirmation_required` without uploading. Per locked decision, stage captures only metadata (mailbox, uid, attachmentFilename, target folder) — the bytes are fetched at confirm time (Task 3), not here.

**Acceptance Criteria:**
- A `save_email_attachment` tool is in `TOOL_DEFINITIONS` with params: `mailbox` (string, required), `uid` (number, required), `attachmentFilename` (string, required), `folder` (string, optional — source mailbox folder hint), `targetFolderId` (string, optional — Graph item id of the OneDrive destination folder), `targetFolderPath` (string, optional — drive-root-relative path, e.g. `/alle firma's/Aquavoy Ltd/Verzonden Facturen/2026`). Its `description` states it is CONFIRMED BEFORE SAVING and references the `Verzonden Facturen/{year}` layout.
- Calling `executeTool("save_email_attachment", validArgs, connId, "Wency")` returns a JSON string with `status: "confirmation_required"`, an `action_id`, and a `summary` — and performs NO upload (does not call `uploadFile`).
- Calling it with no `sessionPrincipal` returns `{ error: "no verified principal in session" }` (the existing fail-closed gate at `onedriveTools.ts:1001-1003`).
- Missing `mailbox` / `uid` / `attachmentFilename` returns a readable `{ error: ... }` without staging.
- A nonexistent mailbox returns the existing no-account shape (`error` + `connected_addresses`), matching the batch-move branch (`onedriveTools.ts:1015-1022`).

**Action:**
1. Add the tool object to `TOOL_DEFINITIONS` (after the batch-move definitions, before `web_search` at `onedriveTools.ts:402`). Description (one paragraph, matching the existing destructive-tool wording at `onedriveTools.ts:341`): "Save an email attachment (e.g. a PDF invoice or credit note) from a connected mailbox into a OneDrive folder. CONFIRMED BEFORE SAVING — calling it stages a confirmation card showing the file name and the destination path; nothing is uploaded until the human approves it in the UI, and it is reversible (undo deletes the uploaded file). Pass the source mailbox + message uid + the exact attachmentFilename (from read_email's attachments list). For the destination, pass targetFolderId OR targetFolderPath; for sent invoices the layout is 'Verzonden Facturen/{year}' (under alle firma's > Aquavoy Ltd). Call ONCE and relay the returned summary; do NOT re-call after the user says yes — confirming is the UI's job."
2. Add `"save_email_attachment"` to the `DESTRUCTIVE` set (`onedriveTools.ts:929-943`) with a one-line comment (ADR-003: confirm-before-write; bytes fetched at confirm, not in the model loop).
3. In `executeTool`, inside the `if (DESTRUCTIVE.has(name))` block, add a branch `if (name === "save_email_attachment") { ... }` BEFORE the generic `summarizeAction` fallback (`onedriveTools.ts:1075`). In it: read+validate `mailbox`, `uid` (coerce via `Number`), `attachmentFilename` (return readable `{ error }` on any missing, same style as `onedriveTools.ts:1012-1013`); resolve the account with `loadAccountWithSecretByEmail(mailbox)` and return the no-account shape if absent (copy `onedriveTools.ts:1015-1022`); read optional `folder`, `targetFolderId`, `targetFolderPath` as strings. Build `summary = \`Save attachment "${attachmentFilename}" from ${mailbox} → ${targetFolderPath || targetFolderId || "OneDrive root"}\``. Call `stagePendingAction({ principal: sessionPrincipal, tool: "save_email_attachment", args: { mailbox, uid, attachmentFilename, folder, targetFolderId, targetFolderPath }, summary })`. Return `JSON.stringify({ status: "confirmation_required", action_id: row.id, summary })`. Do NOT add it to `ONEDRIVE_TOOLS` (it never runs the OneDrive read/write path here; the upload happens in Task 3).
4. Add a `case "save_email_attachment":` to `summarizeAction` (`onedriveTools.ts:946`) returning the same summary string shape as step 3 (so the generic fallback is never the source of truth). (Note: because step 3 builds and passes its own `summary`, this case is the documented backstop; keep both identical.)

**Validation:** (builder self-check)
- `grep -c "save_email_attachment" src/lib/agents/onedriveTools.ts` → ≥ 4 (definition name, DESTRUCTIVE entry, stage branch, summarizeAction case)
- `grep -n "\"save_email_attachment\"" src/lib/agents/onedriveTools.ts | head` shows it inside the `DESTRUCTIVE = new Set([` block
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0

**Context:** Read @src/lib/agents/onedriveTools.ts @src/lib/agents/pendingActions.ts @.planning/decisions/ADR-003-enforced-confirm-undo.md @.planning/scope-m6.md

---

## Task 3 — Confirm-time execute (upload) + undo (delete) for `save_email_attachment`
**Wave:** 2
**Persona:** backend
**Files:**
- `src/lib/agents/executeConfirmedAction.ts` (modify) — add a `case "save_email_attachment":` that downloads the attachment bytes (Task 1's `downloadAttachment`) and uploads to OneDrive (`uploadFile`), returning the new `itemId`/`webUrl` and `undo_data: { uploadedItemId }`.
- `src/lib/agents/pendingActions.ts` (modify) — add a `case "save_email_attachment":` to the `undoAction` switch (`pendingActions.ts:250`) that deletes the uploaded item.
- `src/lib/agents/executeConfirmedAction.test.ts` (modify) — mock `downloadAttachment` + `uploadFile`; test the confirm-time download→upload + the `undo_data` capture + the validation guards.

**Depends on:** Task 1 (imports `downloadAttachment` from `imap.ts`), Task 2 (the staged `args` shape this case consumes).

**Why:** This is the ONLY place the upload actually runs (ADR-003 §3) — reached only after a human confirms the staged row. Per locked decision the bytes are downloaded HERE (confirm time), not at stage time, so a cancel never fetches a large PDF. Undo deletes the uploaded item (reuse the Graph delete flow).

**Acceptance Criteria:**
- Confirming a staged `save_email_attachment` calls `downloadAttachment(mailbox, folder, uid, attachmentFilename)` then `uploadFile(connId, parent, name, bytes, contentType)` and returns `result: { saved: true, itemId, name, webUrl }`.
- The destination `parent` is `{ itemId: targetFolderId }` when `targetFolderId` is set, else `{ path: targetFolderPath }` when `targetFolderPath` is set, else `{}` (OneDrive root).
- `undo_data` is `{ uploadedItemId: <new item id> }`.
- Missing `mailbox` / `uid` / `attachmentFilename` throws a readable error WITHOUT calling `downloadAttachment` or `uploadFile`.
- `undoAction` for a confirmed `save_email_attachment` calls `deleteItem(connId, uploadedItemId)` and moves the row to `undone`; a missing `uploadedItemId` returns `{ undone: false, reason: "uploaded item id unavailable" }`.
- `save_email_attachment` appears in `REVERSIBLE_TOOLS` in `src/app/page.tsx` and `src/app/finance/page.tsx` so the confirm card offers Undo.

**Action:**
1. In `executeConfirmedAction.ts`, import `downloadAttachment` from `@/lib/mail/imap` (extend the existing import at `executeConfirmedAction.ts:11`) and `uploadFile` from `@/lib/microsoft/onedrive` (extend `executeConfirmedAction.ts:1-5`).
2. Add `case "save_email_attachment": { ... }` to the switch (`executeConfirmedAction.ts:41`). Read `mailbox = str(args,"mailbox")`, `uid = Number(args.uid)`, `attachmentFilename = str(args,"attachmentFilename")`, `folder = str(args,"folder") || undefined`, `targetFolderId = str(args,"targetFolderId")`, `targetFolderPath = str(args,"targetFolderPath")`. Guard: `if (!mailbox || !uid || isNaN(uid) || !attachmentFilename) throw new Error("mailbox, uid, and attachmentFilename are required")`. Then `const att = await downloadAttachment(mailbox, folder, uid, attachmentFilename)`. `const connId = await resolveConnectionId()`. `const parent = targetFolderId ? { itemId: targetFolderId } : targetFolderPath ? { path: targetFolderPath } : {}`. `const item = await uploadFile(connId, parent, att.filename, att.bytes, att.contentType)`. Return `{ result: { saved: true, itemId: item.id, name: item.name, webUrl: item.webUrl ?? null }, undo_data: { uploadedItemId: item.id } }`.
3. In `pendingActions.ts` `undoAction` (`pendingActions.ts:250` switch), add `case "save_email_attachment": { const uploadedItemId = typeof undo.uploadedItemId === "string" ? undo.uploadedItemId : ""; if (!uploadedItemId) return { action, undone: false, reason: "uploaded item id unavailable" }; const connId = await resolveConnectionId(); await deleteItemOnDrive(connId, uploadedItemId); break; }`. Import the OneDrive delete: `pendingActions.ts:3` currently imports `{ updateItem }` from `@/lib/microsoft/onedrive` — extend it to `{ updateItem, deleteItem as deleteItemOnDrive }` (matching the alias used in `executeConfirmedAction.ts:4`).
4. Add `"save_email_attachment"` to the `REVERSIBLE_TOOLS` set in `src/app/page.tsx` (`page.tsx:62-69`) and in `src/app/finance/page.tsx` (`finance/page.tsx:61-69`).
5. In `executeConfirmedAction.test.ts`: extend the `@/lib/mail/imap` mock (`executeConfirmedAction.test.ts:41-43`) to add `downloadAttachment: vi.fn()`; extend the `@/lib/microsoft/onedrive` mock (`executeConfirmedAction.test.ts:19-23`) to add `uploadFile: vi.fn()`. Add a `describe("executeConfirmedAction — save_email_attachment")` with: (a) happy path — `downloadAttachment` resolves `{ filename: "invoice.pdf", contentType: "application/pdf", bytes: new Uint8Array([1,2,3]) }`, `uploadFile` resolves `{ id: "drive-1", name: "invoice.pdf", webUrl: "https://...", isFolder: false }`; assert `downloadAttachment` called with `("info@aquavoy.com", undefined, 11, "invoice.pdf")`, `uploadFile` called with parent `{ itemId: "folder-x" }` when `targetFolderId: "folder-x"`, `out.result` is `{ saved: true, itemId: "drive-1", name: "invoice.pdf", webUrl: "https://..." }`, and `out.undo_data` is `{ uploadedItemId: "drive-1" }`; (b) parent resolves to `{ path }` when only `targetFolderPath` is set and `{}` when neither is set; (c) missing `attachmentFilename` rejects with `/required/` and neither `downloadAttachment` nor `uploadFile` was called.

**Validation:** (builder self-check)
- `npx vitest run src/lib/agents/executeConfirmedAction.test.ts` → all pass
- `grep -c "save_email_attachment" src/lib/agents/executeConfirmedAction.ts src/lib/agents/pendingActions.ts` → ≥ 1 each
- `grep -c "save_email_attachment" src/app/page.tsx src/app/finance/page.tsx` → ≥ 1 each
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0

**Context:** Read @src/lib/agents/executeConfirmedAction.ts @src/lib/agents/executeConfirmedAction.test.ts @src/lib/agents/pendingActions.ts @src/lib/microsoft/onedrive.ts @src/app/page.tsx @src/app/finance/page.tsx @.planning/decisions/ADR-005-finance-storage-hybrid.md

**Design:**
- Register: product
- Tokens used: none (programmatic Set entry — no rendered output; no CSS/JSX changed)
- Scope: component
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs` pre-commit (no-op — no style changes)

---

## Task 4 — Document `save_email_attachment` in the SYSTEM_PROMPT
**Wave:** 2
**Persona:** backend
**Files:**
- `src/lib/openrouter/client.ts` (modify) — add a short capability paragraph to the `SYSTEM_PROMPT` array (`client.ts:64`) documenting `save_email_attachment`: its confirm-before-save behavior, the `read_email` → attachments → `save_email_attachment` flow, and the `Verzonden Facturen/{year}` layout.

**Depends on:** Task 2 (the tool must exist and be staged before the prompt documents it).

**Why:** The agent only invokes a tool it knows about. The existing prompt documents every destructive tool's confirm behavior (`client.ts:129-185`); `save_email_attachment` needs the same so the model uses it for "save this invoice attachment to the 2026 folder" and reads the attachment list from `read_email` first.

**Acceptance Criteria:**
- The `SYSTEM_PROMPT` contains a paragraph naming `save_email_attachment`, stating it is staged for confirmation by the app (never runs immediately) and is reversible.
- The paragraph tells the model to get the `attachmentFilename` from `read_email`'s attachments list and to pass a `targetFolderId`/`targetFolderPath` (citing the `Verzonden Facturen/{year}` layout).
- The destructive-tools enumeration at `client.ts:129-137` includes `save_email_attachment`.
- `npx tsc --noEmit` is clean (the file is a `.ts` string array — no JSX/CSS, so no Design block).

**Action:**
1. In the `SYSTEM_PROMPT` array, add `save_email_attachment` to the destructive-tools list sentence at `client.ts:131` (currently `...batch_move_to_trash, batch_move_to_folder) are AUTOMATICALLY staged...`).
2. Add a new numbered capability block after the batch-moves block (after `client.ts:185`, before block 6 at `client.ts:187`), e.g. section "5e. SAVE EMAIL ATTACHMENTS": "use save_email_attachment to file an email's attachment (e.g. a PDF invoice or credit note) into OneDrive. First call read_email to see the message's attachments list, then call save_email_attachment ONCE with the mailbox, the message uid, the exact attachmentFilename, and the destination (targetFolderId or targetFolderPath). Sent invoices live under 'Verzonden Facturen/{year}' (alle firma's > Aquavoy Ltd) — pass that path for the matching year. It is staged for confirmation by the app (never uploads immediately) and is reversible (Undo deletes the uploaded file); relay the returned summary and do NOT re-call after the user says yes."

**Validation:** (builder self-check)
- `grep -c "save_email_attachment" src/lib/openrouter/client.ts` → ≥ 2
- `grep -c "Verzonden Facturen" src/lib/openrouter/client.ts` → ≥ 2 (existing layout note at client.ts:119 + the new one)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0

**Context:** Read @src/lib/openrouter/client.ts @src/lib/agents/onedriveTools.ts

---

## Success Criteria
- [ ] `readEmail()` returns an `attachments[]` array; `downloadAttachment(mailbox, uid, filename)` returns the attachment bytes + content-type. (Task 1)
- [ ] Calling `save_email_attachment` in the agent loop returns `confirmation_required` with an `action_id` and a summary — WITHOUT uploading. (Task 2)
- [ ] Confirming runs the upload to OneDrive and returns the new itemId/webUrl; an undo deletes the uploaded item. (Task 3)
- [ ] No regression in existing mail-read or OneDrive-read tools (`imap.test.ts` + `executeConfirmedAction.test.ts` all green; `tsc` clean). (Tasks 1, 3)
- [ ] The agent knows the tool exists and how to use it (SYSTEM_PROMPT documents it). (Task 4)

## Verification Contract

### Contract for Task 1 — downloadAttachment export
**Check type:** grep-match
**Command:** `grep -c "export async function downloadAttachment" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the attachment-bytes accessor does not exist

### Contract for Task 1 — readEmail exposes attachments
**Check type:** grep-match
**Command:** `grep -c "attachments" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 2 — the EmailDetail field + the mapping)
**Fail if:** Returns 0 — readEmail does not expose attachment metadata

### Contract for Task 1 — IMAP tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/imap.test.ts 2>&1 | grep -c "FAIL"`
**Expected:** `0`
**Fail if:** Any imap.test.ts case fails (regression or new test red)

### Contract for Task 2 — tool registered as DESTRUCTIVE
**Check type:** grep-match
**Command:** `grep -A16 "const DESTRUCTIVE = new Set" src/lib/agents/onedriveTools.ts | grep -c "save_email_attachment"`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the tool would run its side-effect in the model loop (ADR-003 violation)

### Contract for Task 2 — tool definition + stage path present
**Check type:** grep-match
**Command:** `grep -c "save_email_attachment" src/lib/agents/onedriveTools.ts`
**Expected:** ≥ 4 (definition, DESTRUCTIVE entry, stage branch, summarizeAction case)
**Fail if:** < 4 — a required surface is missing

### Contract for Task 3 — confirm-time execute case wired
**Check type:** grep-match
**Command:** `grep -c "save_email_attachment" src/lib/agents/executeConfirmedAction.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — confirming would throw "Not a confirmable destructive action"

### Contract for Task 3 — undo case wired
**Check type:** grep-match
**Command:** `grep -c "save_email_attachment" src/lib/agents/pendingActions.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — undo cannot delete the uploaded item

### Contract for Task 3 — confirm wires download → upload (not stage time)
**Check type:** grep-match
**Command:** `grep -A30 "case \"save_email_attachment\"" src/lib/agents/executeConfirmedAction.ts | grep -cE "downloadAttachment|uploadFile"`
**Expected:** ≥ 2 — both download and upload happen at confirm time
**Fail if:** < 2 — bytes fetched at stage time or upload missing (violates the locked decision)

### Contract for Task 3 — UI marks it reversible
**Check type:** grep-match
**Command:** `grep -c "save_email_attachment" src/app/page.tsx src/app/finance/page.tsx`
**Expected:** Non-zero in BOTH files
**Fail if:** Either returns 0 — the confirm card would not offer Undo

### Contract for Task 3 — confirm tests pass
**Check type:** command-exit
**Command:** `npx vitest run src/lib/agents/executeConfirmedAction.test.ts 2>&1 | grep -c "FAIL"`
**Expected:** `0`
**Fail if:** Any case fails

### Contract for Task 4 — SYSTEM_PROMPT documents the tool
**Check type:** grep-match
**Command:** `grep -c "save_email_attachment" src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — the model has no instruction to use the tool

### Contract for all tasks — TypeScript compiles
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript error
