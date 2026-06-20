---
phase: 4
goal: "Batch sender-move undo restores messages on ANY IMAP server (with or without UIDPLUS), and the recipient autocomplete dropdown is dismissible via Escape in every state."
tasks: 2
waves: 1
type: gap-closure
---

# Phase 4 — Gap Closure: Batch Email Actions

**Goal:** The two required failures from `phase-4-verification.md` are closed: (§A1 HIGH) undo puts moved messages back even when the IMAP server lacks the UIDPLUS extension; (§A2 MEDIUM a11y) Escape dismisses the recipient autocomplete dropdown in loading and no-match states.

**Why this phase:** The phase goal promises "undo that puts the messages back" — today that silently fails on Dovecot/corporate IMAP (no UIDPLUS), stranding emails in Trash with a misleading success-less message. And a polished autocomplete that traps Escape during the new loading/no-match states is a WCAG 2.1 SC 1.4.13 regression. Both block the phase verdict.

**Scope guard:** Fix ONLY §A1 and §A2. §A3 (TOCTOU double-undo, LOW) is a deferred follow-up — do NOT touch `undoAction`'s claim-flip ordering in this cycle. Add no new tools, no migration (undo state rides the existing `pending_actions.undo_data` JSON per ADR-003 / learned-pattern), no new features.

---

## Task 1 — Capability-independent batch-move undo (Message-ID fallback)

**Wave:** 1
**Persona:** backend
**Files:**
- `src/lib/mail/imap.ts` (modify — extend `previewSenderMatches` to capture Message-IDs for the full matched set; add a Message-ID-based reverse-move helper)
- `src/lib/agents/onedriveTools.ts` (modify — persist captured `messageIds` into the staged action args, lines 1042-1053)
- `src/lib/agents/executeConfirmedAction.ts` (modify — carry `messageIds` from args into `undo_data`, batch case lines 228-259)
- `src/lib/agents/pendingActions.ts` (modify — use the Message-ID durable path when `uidMap` is empty, batch case lines 311-336)
- `src/lib/mail/imap.test.ts` (modify — add no-UIDPLUS undo + messageId-capture cases)

**Depends on:** none

**Why:** `imap.ts:500-502` falls back to an EMPTY `uidMap` when the server has no UIDPLUS extension; `pendingActions.ts:331-333` then returns `{ undone: false, reason: "no moved messages to restore" }` even though the forward move at `executeConfirmedAction.ts:247` succeeded — emails are stranded in Trash. The phase goal requires undo to restore messages regardless of UIDPLUS. Message-ID (RFC822 header) survives a move across folders, so capturing it at stage time gives undo a server-capability-independent way to re-locate the moved messages.

**Acceptance Criteria:**
- On an IMAP server WITHOUT UIDPLUS (`messageMove` returns no `uidMap`), confirming a `batch_move_to_trash` / `batch_move_to_folder` and then undoing restores every moved message to the source folder — undo returns `{ undone: true }`, not `{ undone: false, reason: "no moved messages to restore" }`.
- On a server WITH UIDPLUS, undo still uses the fast `uidMap` path (no behavior change, no extra search) — the existing `moveMessages opens source read-write... returns uidMap` test still passes.
- The staged action args and the persisted `undo_data` both carry a `messageIds` map (source UID → Message-ID string) captured at stage time, so undo never depends on the live mailbox state to know which messages it moved.
- `previewSenderMatches` returns a `messageIds: Record<number,string>` field covering the full matched UID set (not just the sample).

**Action:**
1. **`imap.ts` — capture Message-IDs at stage time.** In `previewSenderMatches` (line 422), after computing `uids` (line 436), fetch `messageId` for the FULL matched set (the current fetch at lines 445-451 only covers the newest `size` sample). Add a second lightweight fetch over `uids.join(",")` requesting `{ uid: true, envelope: true }`, and build `const messageIds: Record<number, string> = {}` mapping `msg.uid → (msg.envelope?.messageId ?? "")`, skipping empty IDs. Add `messageIds` to the returned object and to the empty-match early return (`{ folderPath, total: 0, sample: [], uids: [], messageIds: {} }`). Extend the `SenderMatchPreview` interface (line 228) with `messageIds: Record<number, string>`.
2. **`imap.ts` — add a Message-ID reverse-move helper.** Add an exported `async function moveMessagesByMessageId(email: string, fromFolderHint: string, messageIds: string[], destFolderHint: string): Promise<{ movedCount: number; destFolderPath: string }>`. Inside `withClient`: resolve both folders via `fetchFolderList`/`resolveFolder`, `await client.mailboxOpen(fromPath)` read-WRITE, then for the located UIDs call `client.messageMove(...)`. Locate UIDs in the source (= move destination, e.g. Trash) folder by searching each Message-ID: `await client.search({ header: { "message-id": id } }, { uid: true })` (the `header` search term is documented at `node_modules/imapflow/lib/imap-flow.js:2518`; key is `"message-id"`, value is the literal Message-ID string). Collect all matched UIDs across the provided `messageIds`, dedupe, and if non-empty `messageMove(foundUids.join(","), destPath, { uid: true })`. Throw if `messageIds` is empty (mirror the `moveMessages` empty-UID guard at line 485). Return `{ movedCount: foundUids.length, destFolderPath: destPath }`.
3. **`onedriveTools.ts` — persist messageIds into staged args.** In the batch staging block, add `messageIds: preview.messageIds` to the `args` object passed to `stagePendingAction` (currently lines 1045-1051, alongside `uids`, `sourceFolderPath`, `destFolderPath`, `from`).
4. **`executeConfirmedAction.ts` — carry messageIds into undo_data.** In the `batch_move_to_trash`/`batch_move_to_folder` case (lines 228-259): read `args.messageIds` (guard: `const messageIds = args.messageIds && typeof args.messageIds === "object" ? (args.messageIds as Record<string, string>) : {}`) and add `messageIds` to the returned `undo_data` object (alongside `mailbox`, `sourceFolderPath`, `destFolderPath`, `uidMap` at lines 252-257). Do NOT change the forward `moveMessages` call.
5. **`pendingActions.ts` — durable undo on empty uidMap.** In the batch undo case (lines 311-336): keep the existing `uidMap` fast path. After the existing `mailbox`/`sourceFolderPath`/`destFolderPath` guard (line 328-330), when `destUids.length > 0` call `moveMessages(mailbox, destFolderPath, destUids, sourceFolderPath)` as today. When `destUids.length === 0`, read `undo.messageIds` (guard to `Record<string,string>` like the `uidMap` guard at 321-324), collect its string values, and IF non-empty call `await moveMessagesByMessageId(mailbox, destFolderPath, messageIdValues, sourceFolderPath)` (import it from `../mail/imap`). Only return `{ undone: false, reason: "no moved messages to restore" }` when BOTH `destUids` and `messageIdValues` are empty. Then fall through to the existing status-flip at lines 342-353 unchanged.
6. **`imap.test.ts` — cover the new paths.** (a) Extend the `inboxMessages` envelope fixtures (lines 17-38) with a `messageId` field on each (e.g. `messageId: "<msg-11@example.com>"`, `"<msg-12@example.com>"`). (b) Assert `previewSenderMatches(...).messageIds` equals `{ 11: "<msg-11@example.com>", 12: "<msg-12@example.com>" }`. (c) Add a test for `moveMessagesByMessageId`: set `h.ref.current.search = vi.fn(async () => [201])` (the UID found in the dest folder), call `moveMessagesByMessageId("info@aquavoy.com", "Trash", ["<msg-11@example.com>"], "inbox")`, and assert `search` was called with `{ header: { "message-id": "<msg-11@example.com>" } }, { uid: true }` and `messageMove` was called with the found UID string and resolved source path. (d) Add an empty-messageIds guard test mirroring the empty-UID test at lines 208-212.

**Validation:** (builder self-check before commit)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `npx vitest run src/lib/mail/imap.test.ts` → all tests pass, includes the new messageId-capture and `moveMessagesByMessageId` cases
- `grep -n "moveMessagesByMessageId" src/lib/mail/imap.ts src/lib/agents/pendingActions.ts` → present in both (helper exported AND consumed)
- `grep -n "messageIds" src/lib/agents/onedriveTools.ts src/lib/agents/executeConfirmedAction.ts` → present in both (captured at stage, carried into undo_data)
- `ls supabase/migrations/ | grep -c "gap\|0016"` → `0` (no new migration)

**Context:** Read @src/lib/mail/imap.ts @src/lib/agents/onedriveTools.ts @src/lib/agents/executeConfirmedAction.ts @src/lib/agents/pendingActions.ts @src/lib/mail/imap.test.ts @.planning/phase-4-verification.md

---

## Task 2 — Escape dismisses autocomplete in loading and no-match states

**Wave:** 1
**Persona:** ux
**Files:**
- `src/components/RecipientAutocomplete.tsx` (modify — split the compound `onKeyDown` guard at line 145)

**Depends on:** none

**Why:** `RecipientAutocomplete.tsx:145` guards `if (!open || items.length === 0) return` before the `case "Escape"` block (lines 161-165). Phase 4 introduced two states where the dropdown is open with zero items (loading "Searching…" and "No matching recipients") — in both, Escape returns early and is unreachable, trapping keyboard users (WCAG 2.1 SC 1.4.13). Arrow/Enter correctly no-op without items; only Escape is wrongly blocked.

**Acceptance Criteria:**
- While the dropdown shows the loading state ("Searching…", `items.length === 0`), pressing Escape closes the dropdown and resets the active index.
- While the dropdown shows the no-match state ("No matching recipients", `items.length === 0`), pressing Escape closes the dropdown.
- ArrowUp / ArrowDown / Enter still do nothing when there are no real `items` (no crash, no index move) — the forward-nav guard is preserved.
- When `items.length > 0`, selection and navigation behave exactly as before (no regression to ArrowUp/Down wraparound or Enter-to-choose).

**Action:**
In `onKeyDown` (line 144), replace the single guard `if (!open || items.length === 0) return;` (line 145) with a split guard: first `if (!open) return;`, then handle Escape BEFORE the items check —
```ts
if (e.key === "Escape") {
  e.preventDefault();
  setOpen(false);
  setActive(-1);
  return;
}
if (items.length === 0) return; // Arrow/Enter require a real item
```
Then leave the existing `switch (e.key)` (lines 146-168) intact — the now-unreachable `case "Escape"` inside it can stay (harmless) or be removed; do not alter ArrowDown/ArrowUp/Enter. Do not touch the pointer-down close handler (lines 123-133), `choose` (135-142), or any state setters elsewhere.

**Design:**
- Register: product
- Tokens used: none added — this is a keyboard-handler fix only; no style/markup change. Existing tokens (`var(--surface-2/3)`, `var(--accent-subtle)`, `var(--font-mono)`) untouched.
- Scope: component
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/components/RecipientAutocomplete.tsx` pre-commit; commit blocked on critical findings.

**Validation:** (builder self-check before commit)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `grep -n "if (!open) return" src/components/RecipientAutocomplete.tsx` → present (compound guard split)
- `grep -c "items.length === 0) return" src/components/RecipientAutocomplete.tsx` → `1` (the Arrow/Enter guard remains, now AFTER the Escape handler)

**Context:** Read @src/components/RecipientAutocomplete.tsx @.planning/phase-4-verification.md

---

## Success Criteria

- [ ] Undoing a confirmed batch move on an IMAP server without UIDPLUS restores every message to the source folder (undo returns `undone: true`), verified by the new `imap.test.ts` no-UIDPLUS / messageId path.
- [ ] Undo on a UIDPLUS server is unchanged and still uses the `uidMap` fast path.
- [ ] No new migration; undo state rides the existing `pending_actions.undo_data` JSON (`messageIds` added to the JSON only).
- [ ] Escape closes the recipient autocomplete dropdown in the loading and no-match states; Arrow/Enter still no-op without items.
- [ ] `npx tsc --noEmit` reports 0 errors and `npx vitest run` passes.

## Verification Contract

### Contract for Task 1 — undo helper exported and consumed
**Check type:** grep-match
**Command:** `grep -c "moveMessagesByMessageId" src/lib/mail/imap.ts`
**Expected:** Non-zero (≥ 2 — declaration + any internal reference)
**Fail if:** Returns 0 — the capability-independent reverse-move helper was not added

### Contract for Task 1 — undo wires the durable path
**Check type:** grep-match
**Command:** `grep -c "moveMessagesByMessageId" src/lib/agents/pendingActions.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — undo never calls the Message-ID fallback, so it still fails on empty uidMap

### Contract for Task 1 — messageIds captured at stage and carried into undo_data
**Check type:** grep-match
**Command:** `grep -l "messageIds" src/lib/agents/onedriveTools.ts src/lib/agents/executeConfirmedAction.ts`
**Expected:** Both file paths printed
**Fail if:** Either file is missing — messageIds not captured at stage time OR not persisted into undo_data

### Contract for Task 1 — imap tests pass (incl. no-UIDPLUS undo)
**Check type:** command-exit
**Command:** `npx vitest run src/lib/mail/imap.test.ts`
**Expected:** Exit 0, all tests pass
**Fail if:** Any test fails or the suite errors

### Contract for Task 1 — no new migration
**Check type:** command-exit
**Command:** `ls supabase/migrations/`
**Expected:** No file containing `gap` or `0016`
**Fail if:** A new migration file appears — undo state must ride existing undo_data JSON

### Contract for Task 2 — compound guard split (Escape reachable)
**Check type:** grep-match
**Command:** `grep -c "if (!open) return" src/components/RecipientAutocomplete.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the `!open || items.length === 0` compound guard was not split, Escape still trapped

### Contract for Task 2 — Arrow/Enter guard preserved
**Check type:** grep-match
**Command:** `grep -c "items.length === 0) return" src/components/RecipientAutocomplete.tsx`
**Expected:** `1`
**Fail if:** `0` (forward-nav guard removed — Arrow/Enter could crash on empty items) or `> 1` (duplicate guards)

### Contract for Phase — types compile
**Check type:** command-exit
**Command:** `npx tsc --noEmit`
**Expected:** Exit 0, 0 errors
**Fail if:** Any TypeScript error
