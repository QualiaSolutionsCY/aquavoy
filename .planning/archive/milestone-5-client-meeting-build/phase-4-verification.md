---
phase: 4
result: PASS
gaps: 0
---

# Phase 4 Verification — Batch Email Actions

**Goal:** The agent can search a mailbox by sender and, behind the existing confirm/undo gate, move every matching message to trash or to a named folder in one batch — with the count + a sample shown on the confirm card before anything moves, and undo that puts the messages back. Recipient autocomplete is polished.

---

## Contract Results

All 14 machine-contract checks passed in the pre-submitted run (`phase-4-contract-run.json`, generated 2026-06-20T12:29:49Z). Contract runner is accepted as authoritative for the grep-match and tsc checks. Goal-backward verification below covers the data-flow properties the machine contracts cannot capture.

| Task | Check | Result | Notes |
|---|---|---|---|
| T1 | `previewSenderMatches` + `moveMessages` exported | PASS | `imap.ts:422,479` |
| T1 | `messageMove` present | PASS | `imap.ts:497` |
| T1 | vitest 10/10 | PASS | 592 ms, 0 failures |
| T1 | `previewSenderMatches` called in onedriveTools | PASS | `onedriveTools.ts:1012` |
| T1 | `moveMessages` in both confirm + undo | PASS | `executeConfirmedAction.ts:11`, `pendingActions.ts:6` |
| T2 | batch tools registered + DESTRUCTIVE | PASS | 8 occurrences confirmed |
| T2 | confirmed side-effect wired | PASS | `executeConfirmedAction.ts:228-259` |
| T2 | undo wired | PASS | `pendingActions.ts:311-336` |
| T2 | REVERSIBLE_TOOLS in both page components | PASS | `page.tsx:67-68`, `finance/page.tsx:67-68` |
| T2 | system prompt names tools as confirm-staged | PASS | `client.ts:109,143-153` |
| T2 | no new migration | PASS | `ls supabase/migrations/ | grep -c "batch\|0016"` → 0 |
| T3 | loading + empty states present | PASS | grep count 7 |
| T3 | no hardcoded color / banned font | PASS | grep count 0 |
| PHASE | tsc clean | PASS | `npx tsc --noEmit` → 0 errors |

---

## Adversarial Review Adjudication

An adversarial agent raised three findings. All three are confirmed against the actual code. Two are required fixes (§A1 HIGH, §A2 MEDIUM). One is non-blocking (§A3 LOW).

---

## Gap 1 — Undo silently fails on IMAP servers without UIDPLUS (HIGH)

**Severity:** HIGH — "no error handling on user-facing path" — matches HIGH row of Severity Rubric.

**Evidence confirmed:**

`src/lib/mail/imap.ts:500-502`:
```typescript
const uidMap = Object.fromEntries(
  res && res.uidMap ? res.uidMap : new Map<number, number>(),
) as Record<number, number>;
```

imapflow's own JSDoc at `node_modules/imapflow/lib/imap-flow.js:2741`:
```
@property {Map<number,number>} [uidMap] Map of UID values
  (if server has `UIDPLUS` extension enabled) where key is UID in source mailbox
  and value is the UID for the same message in destination mailbox
```

`uidMap` is optional and absent when the IMAP server lacks the UIDPLUS extension. When absent, the fallback `new Map<number, number>()` produces `uidMap = {}`.

`src/lib/agents/pendingActions.ts:325-333`:
```typescript
const destUids = Object.values(uidMap).filter(
  (u): u is number => typeof u === "number" && Number.isFinite(u),
);
...
if (destUids.length === 0) {
  return { action, undone: false, reason: "no moved messages to restore" };
}
```

`Object.values({})` is `[]`. `destUids` is empty. Undo returns `undone: false` with the misleading reason "no moved messages to restore" even though the forward move succeeded and the messages are in Trash. No recovery path is available through the UI.

**Criterion affected:** Criteria 1+2 ("undo restores them") — FAIL on any IMAP server without UIDPLUS.

**Required fix:** At a minimum, detect UIDPLUS capability before staging. In `previewSenderMatches` (or a sibling call at stage time), check `client.capabilities.has("UIDPLUS")` and either (a) refuse to stage the action with a user-readable error, or (b) record Message-IDs for the matched UIDs at stage time so undo can re-locate messages after the move without depending on `uidMap`.

---

## Gap 2 — Escape key trapped in loading and no-match states (MEDIUM, a11y)

**Severity:** MEDIUM — "a11y violation" — matches MEDIUM row of Severity Rubric. Violates WCAG 2.1 SC 1.4.13 (content on hover or focus must be dismissible via keyboard).

**Evidence confirmed:**

`src/components/RecipientAutocomplete.tsx:144-145`:
```typescript
function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (!open || items.length === 0) return;
```

This is the first and only guard in `onKeyDown`. During the loading state (`open=true`, `items.length=0`) and the no-match state (`open=true`, `items.length=0`), execution returns before reaching the `case "Escape"` block at `RecipientAutocomplete.tsx:161-165`. Escape is unreachable in both new states introduced by this phase.

Before Phase 4, the dropdown never opened with `items.length === 0`, so the compound guard was safe. Phase 4 introduced two states where the dropdown is open but `items` is empty. The guard is now incorrect — it traps Escape as an unintended side-effect.

The cooperative verifier described the guard as "intentional" but this was wrong. The forward-path behavior is intentional (Arrow/Enter should do nothing without items); the Escape trap is a regression.

**Required fix:** Split the compound guard. Escape must be reachable whenever `open === true`:

```typescript
function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (!open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    setOpen(false);
    setActive(-1);
    return;
  }
  if (items.length === 0) return; // Arrow/Enter require a real item
  switch (e.key) {
    case "ArrowDown": ...
    case "ArrowUp": ...
    case "Enter": ...
  }
}
```

---

## Gap 3 — TOCTOU double-undo race (LOW, non-blocking)

**Severity:** LOW — narrow race, no user-visible impact under normal use.

`src/lib/agents/pendingActions.ts:240-334` — `undoAction` reads `action.status === "confirmed"`, executes the IMAP move, then flips the row to `undone` — a read-act-write sequence. Two concurrent undo requests on the same `action_id` both pass the `status !== "confirmed"` check at line 244-245, both call `moveMessages`, and both then flip the row. The `confirmAction` path at `pendingActions.ts:161-168` correctly uses an atomic claim-first flip (`UPDATE ... WHERE status='pending'`) before executing the side-effect. `undoAction` lacks this pattern.

The Undo button disappears from the UI after the first undo completes, making this race window extremely narrow in practice. Tracked for a follow-up cycle.

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|---|---|---|---|---|---|
| Batch trash move — confirm + undo (Crit 1) | 5 | 5 | 5 | 5 | PASS |
| Batch folder move — confirm + undo (Crit 2) | 5 | 5 | 5 | 5 | PASS |
| Confirm card shows count + sample before move (Crit 3) | 5 | 5 | 5 | 5 | PASS |
| Recipient autocomplete loading + no-match states (Crit 4) | 5 | 5 | 5 | 4 | PASS |
| Confirm gate unbypassable — no write without confirm (Crit 5) | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** All criteria score ≥ 3 on all dimensions. NO scores below 3.

---

## Code Quality
- TypeScript: PASS — `npx tsc --noEmit` → 0 errors
- Stubs found: 0 across all touched files
- Empty handlers: 0 critical in touched files
- No new migration: confirmed (`ls supabase/migrations/ | grep -c "gap\|0016"` → 0)
- vitest: PASS — 12/12 tests pass (624 ms)

---

## Design Rubric — Phase 4

Frontend touched: `src/components/RecipientAutocomplete.tsx`. Scope: component-only.

| Dim | Score | Evidence |
|---|---|---|
| Typography | 5 | `RecipientAutocomplete.tsx:322` `font-family: var(--font-mono, monospace)` for metadata rows; `font: inherit` for body text; no Inter/system-ui; DESIGN.md §3 mono hierarchy followed |
| Color cohesion | 5 | All color via CSS vars declared in `globals.css:17-55`; zero raw hex values; OKLCH palette throughout |
| States | 5 | Loading (skeleton + "Searching…"), empty ("No matching recipients"), selected/active, disabled, focus ring all present. Escape now reachable in all states (gap closed) |
| Motion intent | 5 | `sonar-sweep` at `RecipientAutocomplete.tsx:367` matches DESIGN.md §7; `@media (prefers-reduced-motion: reduce)` gate at lines 369-374; `--ease-out` used for timing |
| Microcopy | 4 | "Searching…" (line 211) and "No matching recipients" (line 234) are clear and terse; placeholder `"name@aquavoy.com"` is concrete |
| Container depth | 5 | `--surface-2` root → `--surface-3` dropdown → `--accent-subtle` hover; three-layer depth matches DESIGN.md §6 elevation via surface-step |

**Aggregate:** 29/30 (avg 4.83)
**Design verdict:** PASS — all dimensions ≥ 3.

---

## Re-Verification (gap cycle 1)

**Gap closure verified 2026-06-20. Both §A1 and §A2 are closed. No new CRITICAL or HIGH findings introduced.**

### §A1 — UIDPLUS-independent undo (was HIGH, now CLOSED)

**Level 2 — Artifacts:**

`src/lib/mail/imap.ts:529` — `export async function moveMessagesByMessageId(` — the helper is exported and substantive (35 lines, opens the source mailbox read-WRITE, iterates per Message-ID via `client.search({ header: { "message-id": id } }, { uid: true })`, dedupes, and calls `client.messageMove`).

`src/lib/mail/imap.ts:535-537` — `if (messageIds.length === 0) { throw new Error("moveMessagesByMessageId requires at least one Message-ID"); }` — empty-input guard mirrors the `moveMessages` guard at line 499.

`src/lib/mail/imap.ts:233` — `messageIds: Record<number, string>;` — `SenderMatchPreview` interface extended.

`src/lib/mail/imap.ts:439` — `return { folderPath, total: 0, sample: [], uids: [], messageIds: {} };` — early-return (zero-match path) carries the `messageIds` field.

`src/lib/mail/imap.ts:445-453` — Message-ID fetch loop over the full `uids` set (not just the sample), building `messageIds: Record<number, string>`.

`src/lib/mail/imap.ts:472` — `return { folderPath, total: uids.length, sample, uids, messageIds };` — `messageIds` in the normal return.

**Level 3 — Wiring:**

`src/lib/agents/onedriveTools.ts:1049` — `messageIds: preview.messageIds,` — captured at stage time alongside `uids`, `sourceFolderPath`, `destFolderPath`, `from`.

`src/lib/agents/executeConfirmedAction.ts:250-253` — `const messageIds = args.messageIds && typeof args.messageIds === "object" ? (args.messageIds as Record<string, string>) : {};` — guarded read from staged args.

`src/lib/agents/executeConfirmedAction.ts:261-267` — `undo_data: { mailbox, sourceFolderPath, destFolderPath, uidMap: res.uidMap, messageIds }` — `messageIds` carried into `undo_data`.

`src/lib/agents/pendingActions.ts:6` — `import { moveMessages, moveMessagesByMessageId } from "@/lib/mail/imap";` — helper imported.

`src/lib/agents/pendingActions.ts:331-353` — the durable undo path is wired with a true two-branch structure:

```
if (destUids.length > 0) {
  // Fast path: UIDPLUS server
  await moveMessages(mailbox, destFolderPath, destUids, sourceFolderPath);
} else {
  // §A1: no uidMap — re-locate by Message-ID
  const messageIdMap = undo.messageIds && typeof undo.messageIds === "object"
    ? (undo.messageIds as Record<string, string>) : {};
  const messageIdValues = Object.values(messageIdMap).filter(...);
  if (messageIdValues.length === 0) {
    return { action, undone: false, reason: "no moved messages to restore" };
  }
  await moveMessagesByMessageId(mailbox, destFolderPath, messageIdValues, sourceFolderPath);
}
```

`src/lib/agents/pendingActions.ts:344-346` — `return { action, undone: false, ... }` is only reached when BOTH `destUids` and `messageIdValues` are empty — the double-empty guard. The empty-uidMap branch calls `moveMessagesByMessageId`, not just falls through.

**Test coverage:**

`src/lib/mail/imap.test.ts:175-178` — `expect(preview.messageIds).toEqual({ 11: "<msg-11@example.com>", 12: "<msg-12@example.com>" });` — `previewSenderMatches` captures Message-IDs over the full UID set.

`src/lib/mail/imap.test.ts:222-241` — `moveMessagesByMessageId` test: search called with `{ header: { "message-id": "<msg-11@example.com>" } }, { uid: true }`, `messageMove` called with found UID `"201"`, returns `{ movedCount: 1, destFolderPath: "INBOX" }`.

`src/lib/mail/imap.test.ts:243-247` — empty Message-ID guard test.

`npx vitest run src/lib/mail/imap.test.ts` — 12/12 PASS (624 ms).

**UIDPLUS fast path preserved:**

`src/lib/agents/pendingActions.ts:331-333` — `if (destUids.length > 0) { await moveMessages(...) }` — fast path still executes when `uidMap` is non-empty. No extra search performed.

**§A1 verdict: CLOSED.** The empty-uidMap branch in `pendingActions.ts:334-353` now calls `moveMessagesByMessageId` rather than immediately returning `undone: false`. The helper is exported from `imap.ts:529`, imported at `pendingActions.ts:6`, and consumed at `pendingActions.ts:347`. The full chain from stage (`onedriveTools.ts:1049`) through confirm (`executeConfirmedAction.ts:250-267`) through undo (`pendingActions.ts:331-353`) is wired end-to-end.

---

### §A2 — Escape reachable in loading and no-match states (was MEDIUM a11y, now CLOSED)

**Level 2 — Artifacts:**

`src/components/RecipientAutocomplete.tsx:145` — `if (!open) return;` — the compound guard `!open || items.length === 0` has been split. The first guard is now only `!open`.

`src/components/RecipientAutocomplete.tsx:148-153` — Escape handled BEFORE the items-length check:
```typescript
if (e.key === "Escape") {
  e.preventDefault();
  setOpen(false);
  setActive(-1);
  return;
}
```

`src/components/RecipientAutocomplete.tsx:154` — `if (items.length === 0) return; // Arrow/Enter require a real item` — the Arrow/Enter guard is preserved, now positioned AFTER the Escape handler.

**Level 3 — Wiring:**

`grep -c "if (!open) return" src/components/RecipientAutocomplete.tsx` → `2` (one in the `useEffect` pointer-down handler at line 124, one in `onKeyDown` at line 145 — both correct).

`grep -c "items.length === 0) return" src/components/RecipientAutocomplete.tsx` → `1` — exactly one Arrow/Enter guard, no duplicate.

**Behavioral correctness:**

- When `open=true` and `items.length=0` (loading or no-match state): execution passes the `if (!open) return` guard, hits `if (e.key === "Escape")`, calls `setOpen(false); setActive(-1); return`. Escape closes the dropdown.
- When `open=true` and `items.length=0`: Arrow/Down, ArrowUp, Enter all fall through to `if (items.length === 0) return` at line 154 and no-op. No crash, no index move.
- When `open=true` and `items.length > 0`: execution flows into the `switch` as before. Selection, navigation, and wrap-around are intact.
- When `open=false`: `if (!open) return` at line 145 exits immediately. No regression.

**§A2 verdict: CLOSED.** Guard split matches the exact structure required by the gap plan. WCAG 2.1 SC 1.4.13 is now satisfied — the dropdown is dismissible via Escape in every open state.

---

### §A3 — TOCTOU double-undo race (LOW, confirmed NOT touched)

`src/lib/agents/pendingActions.ts:240` — `undoAction` still lacks the atomic claim-first flip used by `confirmAction`. This is correct per the gap-closure scope guard ("do NOT touch `undoAction`'s claim-flip ordering in this cycle"). §A3 remains deferred as a LOW follow-up.

---

### Regression sweep

- `npx tsc --noEmit` → 0 errors (exit 0).
- `npx vitest run src/lib/mail/imap.test.ts` → 12/12 PASS (624 ms), including the new no-UIDPLUS undo + messageId cases at lines 222-247.
- `ls supabase/migrations/ | grep -c "gap\|0016"` → `0`. No new migration.
- No new CRITICAL or HIGH findings in any touched file.

---

## Verdict

PASS — Phase 4 goal achieved. Both required gaps are closed. §A1 (HIGH): undo now restores messages on IMAP servers without UIDPLUS via the Message-ID fallback path wired end-to-end from `imap.ts:529` through `pendingActions.ts:347`; the UIDPLUS fast path is preserved. §A2 (MEDIUM a11y): the compound `onKeyDown` guard at `RecipientAutocomplete.tsx:145` is split so Escape is reachable whenever `open=true`, while Arrow/Enter still no-op on empty items. TypeScript compiles clean; 12/12 tests pass; no new migration. §A3 (LOW TOCTOU) remains deferred as a non-blocking follow-up.
