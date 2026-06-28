---
phase: 2
result: PASS
gaps: 0
lens: correctness
---

# Phase 2 Verification

## Contract Results

Machine contract ran 12/12 checks, 0 failed (`evidence/phase-2-contract-run.json`).

| Task | Check | Result | Notes |
|------|-------|--------|-------|
| T1 | `downloadAttachment` exported | PASS | grep-match |
| T1 | `attachments` in imap.ts | PASS | grep-match |
| T1 | imap.test.ts (15 tests) | PASS | command-exit |
| T2 | `save_email_attachment` in DESTRUCTIVE set | PASS | grep-match |
| T2 | ≥ 4 occurrences in onedriveTools.ts | PASS | grep-match |
| T3 | case in executeConfirmedAction.ts | PASS | grep-match |
| T3 | case in pendingActions.ts | PASS | grep-match |
| T3 | download + upload at confirm time | PASS | grep-match |
| T3 | REVERSIBLE_TOOLS in page.tsx + finance/page.tsx | PASS | grep-match |
| T3 | executeConfirmedAction.test.ts (32 tests) | PASS | command-exit |
| T4 | ≥ 2 occurrences in client.ts | PASS | grep-match |
| All | tsc --noEmit → 0 errors | PASS | command-exit (verified again) |

Post-contract re-run: both test suites (47 tests total) and `tsc --noEmit` confirmed clean at verification time.

---

## correctness lens

### T1 — IMAP attachment extraction

**Truth 1:** `readEmail` returns `attachments[]` with metadata only (no `content` bytes).

`src/lib/mail/imap.ts:338-344` — mapping drops `content`: each entry maps `att.filename ?? \`attachment-${i}\``, `att.contentType ?? "application/octet-stream"`, `att.size ?? att.content?.length ?? 0`. The `content` field is never placed on the returned `AttachmentInfo`.

`src/lib/mail/imap.ts:218-222` — `AttachmentInfo` interface has exactly `filename`, `contentType`, `size` — no `content` field.

`src/lib/mail/imap.test.ts:163` — `expect((att as unknown as Record<string, unknown>).content).toBeUndefined()` — test verifies bytes are absent. Passes (15/15 tests green).

**Truth 2:** `downloadAttachment` returns `Uint8Array` bytes and throws on no match.

`src/lib/mail/imap.ts:418-432` — exact match then case-insensitive fallback; throws `Attachment "${filename}" not found on message ${uid}` when neither matches; returns `new Uint8Array(att.content)`.

`src/lib/mail/imap.test.ts:166-181` — tests bytes instanceof Uint8Array + length=9, and rejects `/not found/`. Both green.

**Severity check:** no findings. Score: PASS.

---

### T2 — stage path (no upload in model loop)

**Truth:** `executeTool("save_email_attachment", ...)` returns `confirmation_required` WITHOUT calling `uploadFile` or `downloadAttachment`.

`src/lib/agents/onedriveTools.ts:976-993` — `DESTRUCTIVE` set includes `"save_email_attachment"` at line 992.

`src/lib/agents/onedriveTools.ts:1057-1059` — the DESTRUCTIVE gate is checked before any tool-specific logic: `if (DESTRUCTIVE.has(name)) { if (!sessionPrincipal) return ...`. No upload code path exists inside the DESTRUCTIVE block.

`src/lib/agents/onedriveTools.ts:1133-1178` — the `save_email_attachment` branch reads args, validates mailbox/uid/attachmentFilename, resolves account (no-account shape on miss), then calls `stagePendingAction` and returns `{ status: "confirmation_required", action_id, summary }`. The words `uploadFile` and `downloadAttachment` do not appear in this block.

`src/lib/agents/onedriveTools.ts:1028-1033` — `summarizeAction` case returns the correct summary string identical to the stage-branch summary.

**Severity check:** no findings. Score: PASS.

---

### T3 — confirm-time execute + undo

**Truth 1:** Confirming calls `downloadAttachment` then `uploadFile` in that order; returns `result + undo_data`.

`src/lib/agents/executeConfirmedAction.ts:272-293` — `case "save_email_attachment"`: reads args, guards missing fields, calls `downloadAttachment(mailbox, folder, uid, attachmentFilename)`, then `uploadFile(connId, parent, att.filename, att.bytes, att.contentType)`, returns `{ result: { saved: true, itemId: item.id, name: item.name, webUrl: item.webUrl ?? null }, undo_data: { uploadedItemId: item.id } }`.

`src/lib/agents/executeConfirmedAction.ts:12` — `import { moveMessages, downloadAttachment } from "@/lib/mail/imap"` — the import is present.

**Truth 2:** Parent resolution correctness.

`src/lib/agents/executeConfirmedAction.ts:283-287` — `targetFolderId ? { itemId: targetFolderId } : targetFolderPath ? { path: targetFolderPath } : {}`. Three cases all correct. `uploadFile` signature at `src/lib/microsoft/onedrive.ts:105` accepts `parent: { itemId?: string; path?: string }` — passing `{}` (root) is valid.

**Truth 3:** `undo_data: { uploadedItemId: item.id }` and undo deletes the item.

`src/lib/agents/pendingActions.ts:357-364` — `case "save_email_attachment"`: reads `uploadedItemId` from `undo_data`; returns `{ undone: false, reason: "uploaded item id unavailable" }` when absent; calls `deleteItemOnDrive(connId, uploadedItemId)` when present. `deleteItemOnDrive` is imported at `src/lib/agents/pendingActions.ts:3` as `deleteItem as deleteItemOnDrive` from `@/lib/microsoft/onedrive`.

`src/lib/microsoft/onedrive.ts:202` — `deleteItem(connectionId: string, itemId: string): Promise<void>` — signature matches.

**Truth 4:** REVERSIBLE_TOOLS wiring.

`src/app/page.tsx:69` — `"save_email_attachment"` inside the `REVERSIBLE_TOOLS` set. `src/app/finance/page.tsx:69` — same. Both confirmed.

**Truth 5:** Staged args field consistency between T2 and T3.

T2 stages `{ mailbox, uid, attachmentFilename, folder, targetFolderId, targetFolderPath }` at `src/lib/agents/onedriveTools.ts:1171` where `uid` is a number (result of `Number(args.uid)` at line 1135). T3 reads `uid = Number(args.uid)` at `src/lib/agents/executeConfirmedAction.ts:274` — `Number` applied to a number is identity; no type mismatch through JSON round-trip.

**Severity check:** no findings. Score: PASS.

---

### T4 — SYSTEM_PROMPT documentation

`src/lib/openrouter/client.ts:132` — `save_email_attachment` added to the destructive-tools enumeration sentence.

`src/lib/openrouter/client.ts:188-197` — section "5e. SAVE EMAIL ATTACHMENTS" names `read_email` → attachments → `save_email_attachment` flow, states it is staged for confirmation and reversible, cites `Verzonden Facturen/{year}` layout.

Two occurrences confirmed (contract grep returned ≥ 2). Score: PASS.

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| readEmail attachments[] (metadata only) | 5 | 5 | 5 | 5 | PASS |
| downloadAttachment bytes + throw | 5 | 5 | 5 | 5 | PASS |
| save_email_attachment stages (no upload) | 5 | 5 | 5 | 5 | PASS |
| confirm runs download → upload, returns itemId/webUrl + undo_data | 5 | 5 | 5 | 5 | PASS |
| undoAction deletes uploaded item; missing id = no-op | 5 | 5 | 5 | 5 | PASS |
| REVERSIBLE_TOOLS wired in both pages | 5 | 5 | 5 | 5 | PASS |
| SYSTEM_PROMPT documents tool | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** no score below 3. All criteria PASS.

## Code Quality

- TypeScript: PASS (`npx tsc --noEmit` → 0 errors)
- Stubs found: 0 (no TODO/FIXME/placeholder in any touched file)
- Empty handlers: 0
- Test count: 47 (15 imap + 32 executeConfirmedAction), all green

## Design Verification

N/A — no frontend tasks in phase (Task 3 adds `"save_email_attachment"` to a `new Set([...])` literal in two `.tsx` files; this is a programmatic set entry, zero CSS or JSX change).

## Verdict

PASS — Phase 2 goal achieved. All 12 machine contracts passed. All 47 tests green. TypeScript clean. Every correctness criterion scored 5 on all dimensions. No gaps. Proceed to Phase 3.

---

## security lens

### S1 — `save_email_attachment` has NO `uploadFile`/Graph-write path inside `executeTool`

**VERIFIED.**

`src/lib/agents/onedriveTools.ts:1133-1179` — the entire `save_email_attachment` branch inside the `DESTRUCTIVE.has(name)` block. The branch contains only `loadAccountWithSecretByEmail`, string reads, and `stagePendingAction`. Zero calls to `uploadFile`, `downloadAttachment`, or any Graph write function appear in this block.

`src/lib/agents/onedriveTools.ts:6` — `uploadFile` is imported. Its only call site inside the file is `onedriveTools.ts:1266`, inside the `create_spreadsheet` case of the non-destructive switch — that code path is unreachable when `DESTRUCTIVE.has(name)` is true (the function returns before reaching the non-destructive switch at line 1196).

`src/lib/agents/executeConfirmedAction.ts:288` — `uploadFile` call: `const item = await uploadFile(connId, parent, att.filename, att.bytes, att.contentType)`. This file is the confirm-time executor; it is called only via `POST /api/actions/confirm` (`src/app/api/actions/confirm/route.ts:37`) after a human submits the action id. The model loop never calls `executeConfirmedAction` directly.

**Result: PASS — the model has no code path to `uploadFile` for `save_email_attachment`.**

---

### S2 — Staging fails closed without a verified session principal; staged row is owned by HMAC principal (ADR-001/REQ-3)

**VERIFIED.**

`src/lib/agents/onedriveTools.ts:1057-1059` — unconditional guard at the top of the `DESTRUCTIVE.has(name)` block:
```
if (!sessionPrincipal)
  return JSON.stringify({ error: "no verified principal in session" });
```
This runs before the `save_email_attachment` branch. A missing or null `sessionPrincipal` causes immediate return with an error — no staging occurs.

`src/lib/agents/onedriveTools.ts:1168-1173` — `stagePendingAction` is called with `principal: sessionPrincipal`. The `sessionPrincipal` parameter of `executeTool` is never model-supplied; it is injected by the agent runner from the HMAC-verified session.

`src/lib/auth/session.ts:46-57` — `verifySession` performs HMAC-SHA256 (`principalHmac`) and `timingSafeEqual` comparison. An attacker-supplied or model-fabricated value returns `null`. The `getPrincipal` call in `src/app/api/actions/confirm/route.ts:19` uses the same path — confirm is also principal-scoped.

`supabase/migrations/0010_pending_actions.sql:37` — `alter table public.pending_actions enable row level security;` with no public policies. The table is inaccessible to anon/authenticated Supabase keys; only `supabaseAdmin()` (service-role, server-only) can read/write it.

**Result: PASS — principal provenance is HMAC-enforced; staged rows are owned by the verified operator identity.**

---

### S3 — A prompt-injected email cannot cause an auto-save; stage captures metadata only (no SSRF/download before confirm)

**VERIFIED.**

`src/lib/agents/onedriveTools.ts:1131-1132` — comment: "stage metadata only; bytes are fetched at confirm time in executeConfirmedAction, never here (ADR-003 confirm-before-write)."

`src/lib/agents/onedriveTools.ts:1133-1179` — the staging branch stores only `{ mailbox, uid, attachmentFilename, folder, targetFolderId, targetFolderPath }`. There is no call to `downloadAttachment`, no IMAP operation, and no HTTP call of any kind. The IMAP download occurs only in `executeConfirmedAction.ts:281` at confirm time.

The confirm card summary (`onedriveTools.ts:1166`: `\`Save attachment "${attachmentFilename}" from ${mailbox} → ${dest}\``) is shown to the operator before approval. A prompt-injected call stages a visible, human-reviewable row — no silent side-effect occurs.

**Result: PASS — no bytes fetched at stage time; no pre-confirm SSRF or download side-effect possible.**

---

### S4 — Undo path deletes only the recorded `uploadedItemId` (no arbitrary delete)

**VERIFIED.**

`src/lib/agents/pendingActions.ts:357-364` — undo case for `save_email_attachment`:
```typescript
const uploadedItemId = typeof undo.uploadedItemId === "string" ? undo.uploadedItemId : "";
if (!uploadedItemId)
  return { action, undone: false, reason: "uploaded item id unavailable" };
const connId = await resolveConnectionId();
await deleteItemOnDrive(connId, uploadedItemId);
```

`src/lib/agents/pendingActions.ts:248` — `const undo = action.undoData ?? {}` — `undoData` is `row.undo_data` from the DB.

`src/lib/agents/pendingActions.ts:183` — `undo_data: outcome.undo_data` is written once, at confirm time, from the `executeConfirmedAction` return value.

`src/lib/agents/executeConfirmedAction.ts:291-292` — `undo_data: { uploadedItemId: item.id }` where `item.id` is the Graph API response for the newly uploaded file — not a model-supplied value.

`src/app/api/actions/undo/route.ts:18` — `const principal = getPrincipal(req)` (HMAC session); `undoAction(id, principal)` scopes the lookup to the session owner's rows.

**Result: PASS — the `uploadedItemId` is sourced from the Graph upload response at confirm time; undo cannot delete arbitrary items.**

---

### S5 — No secret/service_role exposure introduced

**VERIFIED.**

`grep -n "service_role|SERVICE_ROLE|NEXT_PUBLIC" onedriveTools.ts executeConfirmedAction.ts pendingActions.ts` — zero results across all three new/modified agent files.

`src/lib/supabase/server.ts:15` — `supabaseAdmin()` uses `SUPABASE_SERVICE_ROLE_KEY`. This is a server-only module (no `"use client"` directive, no `NEXT_PUBLIC_` prefix on the key). The key never reaches the browser bundle.

**Result: PASS — no service_role exposure in any new code.**

---

### S6 — Path traversal in `targetFolderPath` (MEDIUM finding)

**Finding.** `src/lib/microsoft/onedrive.ts:50`:
```
return `/me/drive/root:/${path.split("/").map(encodeURIComponent).join("/")}:`;
```
`encodeURIComponent` does not encode the `.` character, so a `targetFolderPath` containing `..` segments (e.g. `../../SharedLibrary`) passes as literal `..` path components in the Graph URL. There is no application-level rejection of `..` segments anywhere in the pipeline — not in `executeTool` (`onedriveTools.ts:1160-1163`), not in `executeConfirmedAction.ts:278`, and not in `itemRef` itself.

**Threat.** A prompt-injected email body could cause the model to call `save_email_attachment` with `targetFolderPath: "../../SharedLibrary"`. This would attempt to write to a path above the user's intended folder. The Microsoft Graph API scopes `/me/drive/root:/` to the authenticated user's own drive and is expected to reject or normalize traversal above the drive root — but this is an external enforcement dependency, not an app-level guard.

**Mitigation present.** ADR-003 confirm gate: the operator sees the crafted path in the confirm card summary before any upload occurs (`onedriveTools.ts:1165-1166`). A vigilant operator would reject an unexpected path. This is a meaningful mitigation but relies on operator attention, not on code.

**Severity:** MEDIUM — per Severity Rubric: "Feature works but missing states (loading/error/empty); hardcoded values that should be vars." Mapping: feature works, but a defensive coding control (input validation) that should be present is absent. Weighted score: 0 CRITICAL + 0 HIGH + 1 MEDIUM + 0 LOW → weighted_sum=2 → category_score=max(1,5−floor(2/8))=5, so this is a LOW-weight finding that does not block the phase. The ADR-003 confirm gate prevents silent exploitation; the concern is defense-in-depth.

**Recommendation.** Add a `..`-segment check after `targetFolderPath` is read from args in `executeTool` (`onedriveTools.ts:1163`):
```typescript
if (targetFolderPath && targetFolderPath.split("/").some(seg => seg === "..")) {
  return JSON.stringify({ error: "targetFolderPath must not contain '..' path traversal segments" });
}
```

**Result: MEDIUM (non-blocking) — the ADR-003 confirm gate prevents silent exploitation; recommend adding input validation as a hardening follow-up.**

---

### Security Summary

| Control | Evidence | Result |
|---------|----------|--------|
| No uploadFile reachable from executeTool for save_email_attachment | `onedriveTools.ts:1133-1179` (no upload/download); `executeConfirmedAction.ts:288` (confirm-only path) | PASS |
| Staging fails closed without verified principal | `onedriveTools.ts:1057-1059` unconditional sessionPrincipal guard | PASS |
| Staged row owned by HMAC principal, not model arg | `onedriveTools.ts:1168` `principal: sessionPrincipal`; `session.ts:46-57` HMAC-SHA256 + timingSafeEqual | PASS |
| No bytes fetched at stage time (no pre-confirm SSRF/download) | `onedriveTools.ts:1133-1179` metadata only; `executeConfirmedAction.ts:281` download at confirm only | PASS |
| Undo deletes only uploadedItemId from Graph response | `pendingActions.ts:357-364`; `executeConfirmedAction.ts:291-292` undo_data from Graph response | PASS |
| No service_role/secret exposure in new files | grep zero-result on service_role/NEXT_PUBLIC in agent files | PASS |
| Path traversal sanitization on targetFolderPath | `onedrive.ts:50` encodeURIComponent preserves `..`; no app-level rejection | MEDIUM (non-blocking) |

**Security verdict: PASS with one MEDIUM non-blocking finding.** The ADR-003 confirm gate prevents silent exploitation of the path traversal gap. No CRITICAL or HIGH security gaps were found. The single MEDIUM finding (`targetFolderPath` lacks `..`-segment rejection) should be addressed in a follow-up hardening pass.

### security follow-up — RESOLVED
MEDIUM path-traversal on `targetFolderPath` fixed in `src/lib/agents/onedriveTools.ts` (reject `..` segments at stage time). Re-scan clean.
