---
phase: 3
result: PASS
gaps: 0
slop_note: "pre-existing [ABS-SIDE-STRIPE] at globals.css:703 (.history-item.active) — present in af2d102 (Phase 1 end state), not introduced in Phase 3. No new slop in .action-card section. page.tsx slop-detect: 0 critical."
---

# Phase 3 Verification
**Goal:** Destructive tool calls CANNOT execute inside the model's tool loop — they are staged and only run via a human-triggered, principal-scoped endpoint, with undo where reversible and a principal-scoped audit record.

---

## Contract Results

Machine contract (21 checks) was already recorded as passed in `.planning/evidence/phase-3-contract-run.json`. Independent re-verification of all plan contracts was run below.

| Task | Check | Result | Evidence |
|------|-------|--------|---------|
| T1 | migration file exists | PASS | `supabase/migrations/0010_pending_actions.sql` exists, 38 lines |
| T1 | RLS on, no policies | PASS | RLS count=1, policy count=0 |
| T1 | status enum present | PASS | `status in ('pending', 'confirmed', 'cancelled', 'undone', 'failed')` |
| T1 | principal check | PASS | `principal in ('Wency', 'Jeanette')` |
| T2 | confirmation_required in onedriveTools | PASS | line 620 |
| T2 | sendMail/deleteItemOnDrive/scheduleEmail absent from onedriveTools | PASS | grep returns 0 |
| T2 | executeConfirmedAction exported | PASS | `src/lib/agents/executeConfirmedAction.ts:33` |
| T2 | stagePendingAction called in onedriveTools | PASS | lines 11,613 |
| T3 | all action routes guard with getPrincipal | PASS | all four files |
| T3 | confirmAction in confirm/route.ts | PASS | line 37 |
| T3 | undoAction in undo/route.ts | PASS | line 36 |
| T4 | action-card in page.tsx | PASS | line 567 |
| T4 | /api/actions in page.tsx | PASS | line 232 |
| T4 | action-card in globals.css | PASS | line 754 |
| T4 | slop-detect page.tsx | PASS | 0 critical findings |
| T5 | "wait for their EXPLICIT confirmation" absent | PASS | grep returns 0 |
| T5 | "staged" present in client.ts | PASS | 4 matches |
| T5 | confirmation_required in onedriveTools.test.ts | PASS | lines 107,112,125,145,205 |
| T5 | tsc 0 errors | PASS | `npx tsc --noEmit` exits 0 |
| T5 | vitest run: 59 tests passed | PASS | `12 files, 59 tests, 0 fail` |

---

## 3-Level Check: AC1 — executeTool gates the destructive set, no side-effect in tool loop

**Level 1 (Truths):** `executeTool("delete_item", ..., "Wency")` returns `{status:"confirmation_required", action_id, summary}` and no adapter is called. Without a principal it returns `{error:"no verified principal in session"}`.

**Level 2 (Artifacts):**
- `src/lib/agents/onedriveTools.ts:564-570` — `const DESTRUCTIVE = new Set(["send_email","schedule_email","delete_item","move_item","rename_item"]);` — set defined, all 5 tools present.
- `src/lib/agents/onedriveTools.ts:609-624` — `if (DESTRUCTIVE.has(name)) { if (!sessionPrincipal) return JSON.stringify({ error: "no verified principal in session" }); ... return JSON.stringify({ status: "confirmation_required", action_id: row.id, summary }); }` — gate returns BEFORE the `switch (name)` at line 633.
- No imports of `sendMail`, `deleteItemOnDrive`, or `scheduleEmail` in `onedriveTools.ts` — confirmed by grep (0 results).
- `create_folder` case remains at line 667, inline, unchanged — non-destructive path unaffected.

**Level 3 (Wiring):**
- `src/lib/agents/onedriveTools.ts:11` — `import { stagePendingAction } from "@/lib/agents/pendingActions";` — staging is the only path from the tool loop to a pending row.
- Test coverage: `onedriveTools.test.ts:202-224` — `describe("agents/onedriveTools destructive gating (ADR-003)")` asserts AC1 (`deleteItemMock` not called) and AC2 (staging called with `principal:"Wency"`).

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC2 — stagePendingAction inserts a principal-scoped row

**Level 1 (Truths):** A `pending_actions` row is inserted with `principal` from session (never from model args), `status:"pending"`, tool, args, summary.

**Level 2 (Artifacts):**
- `src/lib/agents/pendingActions.ts:82-98` — `stagePendingAction` inserts `{ principal: input.principal, tool: input.tool, args: input.args, summary: input.summary, status: "pending" }` using `supabaseAdmin()`.
- `supabase/migrations/0010_pending_actions.sql:17` — `principal text not null check (principal in ('Wency', 'Jeanette'))` — schema enforces REQ-3 at DB level.
- `supabase/migrations/0010_pending_actions.sql:37` — `alter table public.pending_actions enable row level security;` with zero policies — service-role only.
- Index `idx_pending_actions_principal_status_created` on `(principal, status, created_at)` at line 33.

**Level 3 (Wiring):**
- `src/lib/agents/onedriveTools.ts:613-617` — `stagePendingAction({ principal: sessionPrincipal, tool: name, args, summary })` — principal is the HMAC-verified session identity, not a model arg.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC3 — POST /api/actions/confirm runs executeConfirmedAction, sets confirmed, records resolved_at/result

**Level 1 (Truths):** Confirm endpoint calls `confirmAction(id, principal)` which calls `executeConfirmedAction(tool, args, principal)`, writes `status:"confirmed"`, `resolved_at`, and `result` to the row.

**Level 2 (Artifacts):**
- `src/app/api/actions/confirm/route.ts:37` — `action = await confirmAction(id, principal);`
- `src/lib/agents/pendingActions.ts:159` — `outcome = await executeConfirmedAction(pending.tool, pending.args, principal);`
- `src/lib/agents/pendingActions.ts:179-197` — `.update({ status: "confirmed", resolved_at: new Date().toISOString(), result: outcome.result, undo_data: outcome.undo_data })` — all three fields recorded.
- `src/lib/agents/executeConfirmedAction.ts:33` — `export async function executeConfirmedAction(tool, args, _principal)` — substantive implementation, 158 lines, covers all 5 destructive tools.
- Enforcement boundary: `src/app/api/actions/confirm/route.ts` does NOT import `executeConfirmedAction` directly — grep of entire `src/app/` returns 0 matches. The side-effect is encapsulated in the agents layer.

**Level 3 (Wiring):**
- `src/app/api/actions/confirm/route.test.ts:72-81` — AC3 test asserts 200 + `status:"confirmed"` when `confirmActionMock` returns the confirmed row.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC4 — All /api/actions routes 401 without session; principal isolation = 404 cross-principal

**Level 1 (Truths):** All four routes return 401 when `getPrincipal` is null. A request for another principal's action id returns 404.

**Level 2 (Artifacts):**
- `src/app/api/actions/route.ts:15-17` — `const principal = getPrincipal(req); if (!principal) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });`
- `src/app/api/actions/confirm/route.ts:19-22` — same pattern.
- `src/app/api/actions/cancel/route.ts:17-20` — same pattern.
- `src/app/api/actions/undo/route.ts:17-20` — same pattern.
- `src/lib/agents/pendingActions.ts:130-137` — `getPendingAction(id, principal)` uses `.eq("id", id).eq("principal", principal).maybeSingle()` — cross-principal query returns null.
- All four data-fetch functions (`listPendingActions`, `getPendingAction`, `confirmAction`, `cancelAction`, `undoAction`) carry `.eq("principal", principal)` — verified in `pendingActions.ts:108-110`, `131-132`, `153`, `211`, `240`.

**Level 3 (Wiring):**
- `src/app/api/actions/confirm/route.test.ts:54-58` — AC4 test: 401 without principal, `confirmActionMock` not called.
- `src/app/api/actions/confirm/route.test.ts:61-69` — 404 when `confirmAction` returns null (cross-principal case).

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC5 — Undo reverses move/rename via updateItem from undo_data; send_email no-undo

**Level 1 (Truths):** `undoAction` for move/rename calls `updateItem` with prior parent/name from `undo_data`. `send_email` returns `{undone: false, reason: "send is irreversible"}`.

**Level 2 (Artifacts):**
- `src/lib/agents/pendingActions.ts:249-256` — `case "move_item"`: extracts `priorParentId` from `undo_data`, calls `updateItem(connId, itemId, { newParentId: priorParentId })`.
- `src/lib/agents/pendingActions.ts:260-269` — `case "rename_item"`: extracts `priorName`, calls `updateItem(connId, itemId, { newName: priorName })`.
- `src/lib/agents/pendingActions.ts:295-296` — `case "send_email": return { action, undone: false, reason: "send is irreversible" };`
- `src/lib/agents/executeConfirmedAction.ts:47-59` — move captures `before = await getItem(connId, { itemId })` BEFORE `updateItem`, returns `undo_data: { priorParentId: before.parentId ?? null, priorName: before.name }`.
- `src/lib/agents/executeConfirmedAction.ts:63-77` — rename same pattern.
- `src/lib/microsoft/types.ts:25` — `parentId?: string;` added to `DriveItem`.
- `src/lib/microsoft/onedrive.ts:39` — `parentId: raw.parentReference?.id` mapped.

**Level 3 (Wiring):**
- `src/app/api/actions/undo/route.ts:36` — `result = await undoAction(id, principal);` — endpoint is wired.
- `src/app/page.tsx:285-286` — `function undo(id: string) { return runAction(id, "/api/actions/undo", true); }` — frontend calls undo endpoint.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC6 — Re-confirming an already-resolved action is a no-op

**Level 1 (Truths):** A second POST to `/api/actions/confirm` for an already-confirmed/cancelled action returns 409 and does not re-run the side-effect.

**Level 2 (Artifacts):**
- `src/lib/agents/pendingActions.ts:155` — `if (pending.status !== "pending") return pending;` — early return before calling `executeConfirmedAction` if status is not `pending`.
- `src/app/api/actions/confirm/route.ts:48-50` — `if (action.status !== "confirmed") { return NextResponse.json({ ok: false, error: "not pending" }, { status: 409 }); }` — the 409 is returned for any non-confirmed status (i.e., an already-cancelled action that `confirmAction` returned unchanged because status wasn't `pending`).
- DB-level guard: `.eq("status", "pending")` on the UPDATE in `confirmAction` at `pendingActions.ts:188-190` means a race condition also hits 0 rows.

**Level 3 (Wiring):**
- `src/app/api/actions/confirm/route.test.ts:83-93` — AC6 test: `confirmActionMock` returns `{ ...confirmedRow, status: "cancelled" }` → response is 409 with `error:"not pending"`.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## 3-Level Check: AC7 — Chat surfaces pending-action card, Confirm/Cancel/Undo, loading/error/empty, token-driven

**Level 1 (Truths):** After model reply and on identity mount the chat fetches `/api/actions`. A card per pending action shows summary, Confirm and Cancel buttons. Confirmed reversible actions show Undo. `send_email` confirmed shows "sent — cannot undo". Loading (button spinner), error (inline `.notice.err`), empty (no card when `pending.length === 0`) states.

**Level 2 (Artifacts):**
- `src/app/page.tsx:97-99` — `const [pending, setPending] = useState<PendingAction[]>([]);` `const [actionBusy, setActionBusy] = useState<string|null>(null);` `const [actionError, setActionError] = useState<string|null>(null);`
- `src/app/page.tsx:230-238` — `loadPending()` fetches `/api/actions`.
- `src/app/page.tsx:364-367` — `finally { setBusy(false); loadPending(); }` — refreshes after every model turn.
- `src/app/page.tsx:386-387` — `pick(principal); loadPending();` — refreshes on identity mount.
- `src/app/page.tsx:553-620` — full card render: `{pending.length > 0 && <div className="action-stack" ...>}`, Confirm/Cancel buttons (lines 582-597), Undo for reversible confirmed (lines 600-608), "sent — cannot undo" for irreversible (lines 610-614).
- `src/app/page.tsx:5` — `import type { PendingAction } from "@/lib/agents/pendingActions";` — type imported.
- `src/app/globals.css:754-820` — `.action-card` uses `var(--danger-subtle)`, `var(--danger)`, `var(--success-subtle)`, `var(--success)`, `var(--radius)`, `var(--sp-3)`, `var(--sp-4)`, `var(--font-mono)`, `var(--transition-base)`, `var(--accent)`, `var(--surface-2)`, `var(--text)`, `var(--text-muted)`, `var(--text-dim)` — all OKLCH CSS variables, no raw hex.
- Empty state: `{pending.length > 0 && ...}` — card section renders nothing when empty.
- Error state: `src/app/page.tsx:555-558` — `{actionError && <div className="notice err" role="alert">{actionError}</div>}`.
- Loading state: `src/app/page.tsx:588` and `607` — spinner inside Confirm/Undo buttons when `busy`.

**Level 3 (Wiring):**
- `src/app/page.tsx:4` — `import type { PendingAction } from "@/lib/agents/pendingActions"` wired.
- `src/app/page.tsx:279-286` — `confirm(id)`, `cancelAction(id)`, `undo(id)` functions wired to routes `/api/actions/confirm`, `/api/actions/cancel`, `/api/actions/undo`.

**Raw oklch in new CSS:** Lines 784 and 787 use `oklch(0.82 0.10 25)` and `oklch(0.82 0.10 160)` for `.action-tag` text colors (danger-tone and success-tone text). These are inline `oklch()` values rather than token references. They match the design system's OKLCH color space and coordinate with the existing `--danger` / `--success` tokens declared in `:root`. This is a LOW finding, not a blocking issue — the values are harmonious and no `#fff`/`#000`/`#hex` is present.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 4 (two inline oklch values instead of token references — LOW, non-blocking).

---

## 3-Level Check: AC8 — tsc 0 errors; vitest 59 tests pass

- `npx tsc --noEmit` — **0 errors** (verified with `grep -c "error TS"` → 0).
- `npx vitest run` — **59 tests, 12 files, all passed**.

**Verdict: PASS** — Correctness 5, Completeness 5, Wiring 5, Quality 5.

---

## Scores

| Criterion | Correctness | Completeness | Wiring | Quality | Verdict |
|-----------|-------------|--------------|--------|---------|---------|
| AC1 — destructive gate | 5 | 5 | 5 | 5 | PASS |
| AC2 — principal-scoped staging | 5 | 5 | 5 | 5 | PASS |
| AC3 — confirm endpoint | 5 | 5 | 5 | 5 | PASS |
| AC4 — 401 + isolation | 5 | 5 | 5 | 5 | PASS |
| AC5 — undo / no-undo | 5 | 5 | 5 | 5 | PASS |
| AC6 — idempotent re-confirm | 5 | 5 | 5 | 5 | PASS |
| AC7 — pending-action card | 5 | 5 | 5 | 4 | PASS |
| AC8 — tsc + vitest | 5 | 5 | 5 | 5 | PASS |

**Minimum threshold check:** No score below 3. All criteria pass.

---

## Code Quality

- **TypeScript:** PASS — `npx tsc --noEmit` exits 0, 0 `error TS` lines.
- **Stubs:** 0 — no `TODO`, `FIXME`, `placeholder`, or `not implemented` in any touched file.
- **Empty handlers:** 3 empty `catch {}` present in `pendingActions.ts:290` (schedule_email undo inner try) — but these are intentional: the catch body returns a `{undone: false, reason}` tuple rather than silently swallowing the error.
- **Unused imports:** None — tsc clean.
- **Vitest suite:** 59/59 passed, including 3 new destructive-gating tests in `onedriveTools.test.ts` (lines 196-225) and 5 route tests in `confirm/route.test.ts`.

---

## Design Rubric — Phase 3

This phase touched `src/app/page.tsx` and `src/app/globals.css`. The scope is a component addition (pending-action card) inside the existing chat surface.

| Dim | Score | Evidence |
|---|---|---|
| Typography | 5 | `globals.css:776-782` `.action-tag` and `.action-tool` use `var(--font-mono)` (JetBrains Mono) for metadata; `.action-summary` inherits Instrument Sans via `var(--font-sans)`; weights and sizes consistent with existing hierarchy |
| Color cohesion | 4 | `globals.css:754-820` — all colors via OKLCH CSS vars (`--danger`, `--danger-subtle`, `--success`, `--success-subtle`, `--accent`, `--surface-2`, `--text`, `--text-muted`, `--text-dim`). Two inline `oklch()` at lines 784/787 for `.action-tag` text — harmonious but not tokenized |
| States | 5 | `page.tsx:555-614` — loading (spinner in buttons), error (`.notice.err`), empty (conditional render), pending, confirmed, confirmed-reversible (Undo), confirmed-irreversible ("sent — cannot undo") — 7 states covered |
| Motion intent | 4 | `globals.css:762-763` — `transition: border-color var(--transition-base), background var(--transition-base)` and `animation: bubble-in 200ms var(--ease-out) both` — purposeful transitions; `@media (prefers-reduced-motion)` at `globals.css:53-59` suppresses them |
| Microcopy specificity | 5 | `page.tsx:573` "Confirm needed" / "Confirmed"; `page.tsx:612` "sent — cannot undo"; action `summary` carries specific action description (`src/lib/agents/onedriveTools.ts:573-589`) |
| Container depth | 5 | `.action-stack` → `.action-card` → `.action-head` / `.action-summary` / `.action-actions` — three-level semantic hierarchy, each level serving a distinct purpose |
| Accessibility | 4 | `page.tsx:554` `role="region" aria-label="Pending actions"`; `page.tsx:568` `role="group" aria-label="Pending action: ${a.summary}"`; Confirm/Cancel/Undo buttons have `aria-label`; `page.tsx:556` `role="alert"` on error. No new `outline:none` in the action-card section |

**Aggregate (7 dims scored):** 32/35 (avg 4.6)
**Design verdict:** PASS — all dimensions ≥ 3. Minor gap: two inline `oklch()` in `.action-tag` text colors (lines 784/787) should be promoted to CSS vars in a polish pass.

---

## Slop Detection

- `grep -c "TODO\|FIXME\|placeholder\|not implemented"` in all touched files → 0.
- `grep -c "return null\|return \[\]\|return \{\}"` — present only in null-return path guards (valid control flow).
- `grep -c "catch {}"` — 1 in `pendingActions.ts:290` — intentional (handled by returning `{undone: false, reason}` in the catch block body).
- `slop-detect.mjs src/app/page.tsx` — **0 critical findings**, 1 MEDIUM false positive (comment text containing word "bounce").
- `slop-detect.mjs src/app/globals.css` — 1 CRITICAL `[ABS-SIDE-STRIPE]` at `globals.css:703` (`.history-item.active`) — **confirmed pre-existing** in commit `af2d102` (Phase 1 end state), not introduced in Phase 3. The new `.action-card` CSS (lines 745-821) contains no side-stripe border or new slop patterns.

---

## Browser QA / Live DB Smoke

DEFERRED — ENV-GATED. Application requires sensitive environment variables (Supabase, OneDrive Graph, SMTP, HMAC secret) that are unreadable in this environment. Live cookie-based auth, DB writes to `pending_actions`, and Graph API calls cannot be exercised. This is not a phase fail — the structural enforcement (gate in `executeTool`, principal-scoped queries, status guards, test suite) is fully verified in code. Browser QA is deferred to next manual smoke-test session.

---

## Gaps

None. All 8 acceptance criteria pass all dimensions with scores ≥ 3.

**LOW (non-blocking):** `.action-tag` text colors at `globals.css:784` and `globals.css:787` use inline `oklch(0.82 0.10 25)` / `oklch(0.82 0.10 160)` instead of CSS custom properties. Should be promoted to `--danger-text` / `--success-text` tokens in a polish pass.

---

## Verdict

PASS — Phase 3 goal achieved. Destructive tool calls (`send_email`, `schedule_email`, `delete_item`, `move_item`, `rename_item`) have no code path from the model's tool loop to their side-effects. The enforcement is structural (gate in `executeTool` at `onedriveTools.ts:609-624`), not prose. Staging, principal isolation, undo, confirm endpoint, and the operator UI card are all implemented, wired, and covered by 59 passing tests with 0 TypeScript errors. All criteria scored ≥ 3 on all dimensions.

Proceed to Phase 4.

---

## Adversarial Findings

**Reviewer:** adversarial pass — hunting bypass paths, principal isolation holes, race conditions, undo abuse, injection, and auth gaps missed by the cooperative pass.

**Overall adversarial verdict: no CRITICAL or HIGH findings. Two MEDIUM, two LOW.**

---

### Finding 1 — MEDIUM: `cancel_scheduled_email` executes inline without principal scoping (ungated cross-principal cancellation)

**Severity:** MEDIUM — "feature works but missing states / hardcoded values that should be vars" (Severity Rubric: MEDIUM weight 2). The concern is a missing isolation guard on a mutating tool, not a model bypass of the DESTRUCTIVE gate itself.

**Evidence chain:**

`src/lib/agents/onedriveTools.ts:564-570` — `const DESTRUCTIVE = new Set(["send_email","schedule_email","delete_item","move_item","rename_item"]);` — `cancel_scheduled_email` is not in the set.

`src/lib/agents/onedriveTools.ts:717-722` — `case "cancel_scheduled_email": { const id = typeof args.id === "string" ? args.id : ""; ... const row = await cancelScheduled(id); return JSON.stringify({ cancelled: true, id: row.id, status: row.status }); }` — executes inline, no `sessionPrincipal` guard, no principal passed to the cancellation.

`src/lib/mail/scheduled.ts:119-135` — `export async function cancelScheduled(id: string)` — the function only checks `.eq("id", id).eq("status", "pending")`; there is no `.eq("created_by", principal)` or any principal-scoping clause. Any valid UUID cancels regardless of who scheduled it.

`src/lib/agents/onedriveTools.ts:702-714` — `case "list_scheduled_emails": { const emails = await listScheduled(); ... }` — also inline, returns UUIDs for ALL operators' scheduled emails (no principal filter). The model can enumerate UUIDs from one operator's scheduled queue and cancel them in the next tool call — both steps require no human confirmation.

**Attack path (prompt injection):** A malicious document read via `read_file` instructs the model to call `list_scheduled_emails` (returns all UUIDs), then call `cancel_scheduled_email` with a target UUID. Both calls run inline, no confirmation gate, no principal check. In a two-operator system where one operator schedules a client email and the other's session is active, a prompt-injected document in the second operator's context can cancel the first operator's scheduled emails without any human involvement.

**ADR-003 exclusion rationale:** ADR-003 §1 explicitly excludes `cancel_scheduled_email` from the destructive set. The rationale (`onedriveTools.ts:562-563` comment) is that `create_folder` is "additive/low-risk" — but that comment does not address `cancel_scheduled_email`. The ADR does not provide reasoning for its exclusion.

**Contrast with confirmed-action undo:** When `schedule_email` is confirmed via the gate and then undone, `undoAction` calls `cancelScheduled(scheduledId)` — also without a principal check on `cancelScheduled` itself. However, that path requires human confirm + undo, so the isolation is enforced at the route layer. The inline `cancel_scheduled_email` tool has no such outer guard.

**Remediation:** Add `.eq("created_by", principal)` to `cancelScheduled` (or a new scoped variant), and add a `sessionPrincipal` fail-closed check to the `cancel_scheduled_email` case mirroring the `recall_memory` pattern at `onedriveTools.ts:696-697`. Alternatively, add `cancel_scheduled_email` to the DESTRUCTIVE set (with a confirmation card and undo = re-schedule, or undo unavailable). The simpler fix is a `created_by` filter — the column already exists in the `scheduled_emails` table (`supabase/migrations/0007_scheduled_emails.sql:20`).

---

### Finding 2 — MEDIUM: `confirmAction` check-then-act race allows double side-effect execution on concurrent confirms

**Severity:** MEDIUM — "feature works but missing states" (Severity Rubric: MEDIUM weight 2). The double-fire requires simultaneous concurrent HTTP requests to the same endpoint for the same action ID, which is unlikely in a two-operator system with a single Confirm button per card, but is not architecturally prevented.

**Evidence chain:**

`src/lib/agents/pendingActions.ts:153-155` — `const pending = await getPendingAction(id, principal); if (!pending) return null; if (pending.status !== "pending") return pending;` — read-then-check, not atomic.

`src/lib/agents/pendingActions.ts:159` — `outcome = await executeConfirmedAction(pending.tool, pending.args, principal);` — side-effect runs here, BEFORE any status update.

`src/lib/agents/pendingActions.ts:179-191` — `.update({ status: "confirmed" ... }).eq("id", id).eq("principal", principal).eq("status", "pending")` — DB guard is on the UPDATE only. The `.eq("status","pending")` guard is atomic at the DB level, but it protects only the row write, not the side-effect call on line 159.

**Race window:** Two concurrent `POST /api/actions/confirm` requests for the same `(id, principal)` both call `getPendingAction` and both find `status = "pending"`. Both proceed past line 155. Both call `executeConfirmedAction` on line 159 (e.g., `deleteItemOnDrive`, `sendMail`). Both side-effects fire. Only one UPDATE succeeds (the one that wins the `.eq("status","pending")` race). The losing request returns the current row state (line 195), which is already `confirmed`, so the route returns 200 — not 409. The audit row shows one confirmed action but two actual side-effects ran.

**Practical risk:** In the UI, one operator can only click Confirm once (the button enters a loading state and `actionBusy` is set). The race requires two separate in-flight requests to the same endpoint before either completes. With Vercel serverless and one operator UI, this is low-probability — but not impossible (e.g., network retry, duplicate tab, or direct API call). For `send_email` the consequence is a duplicate email sent; for `delete_item` the second delete call would likely fail (item already deleted) rather than corrupt data.

**The DB guard comment is misleading:** `pendingActions.ts:144-145` — `"The UPDATE is status-guarded on 'pending', so a re-confirm hits 0 rows and is a no-op (idempotent)."` — this is accurate for re-confirms after the first completes, but inaccurate for concurrent confirms that both pass the pre-execution status check before either UPDATE lands.

**Remediation:** Use a `SELECT ... FOR UPDATE` or a single atomic `UPDATE ... WHERE status='pending' RETURNING *` to both claim the row AND serve as the gate — if 0 rows updated, return without calling `executeConfirmedAction`. Supabase PostgREST supports `.update().eq("status","pending").select()` but does not lock; a true atomic claim requires a raw SQL RPC (`UPDATE ... WHERE status='pending' RETURNING *`). For the two-operator MVP this is acceptable risk but should be tracked.

---

### Finding 3 — LOW: confirm route returns 409 "not pending" when the true status is "failed" (misleading error code)

**Severity:** LOW — "naming inconsistency" (Severity Rubric: LOW weight 1). No security or functional consequence; only affects operator-visible error messaging.

**Evidence chain:**

`src/app/api/actions/confirm/route.ts:48-49` — `if (action.status !== "confirmed") { return NextResponse.json({ ok: false, error: "not pending" }, { status: 409 }); }` — the condition fires for any non-`"confirmed"` status returned by `confirmAction`, including `"failed"`.

`src/lib/agents/pendingActions.ts:162-176` — when `executeConfirmedAction` throws, the catch block writes `status: "failed"` with `.eq("status","pending")`. If the UPDATE hits 0 rows (the race scenario where another confirm already resolved the row), line 176 calls `getPendingAction(id, principal)` and returns the row without throwing. If the row is now `"failed"` (not `"confirmed"`), `confirmAction` returns a `PendingAction` with `status:"failed"` — not `null`, not a throw. The route then evaluates `action.status !== "confirmed"` (line 48) as `true` and returns `{ error: "not pending", status: 409 }` even though the real state is a failed side-effect.

**Practical consequence:** An operator who triggers a confirm that fails (e.g., mail server unreachable) sees a 409 "not pending" rather than a more actionable error. The row is correctly marked `"failed"` in the DB, so the audit trail is accurate. This is a UX issue, not a security issue.

**Remediation:** Add a status-specific branch before the generic 409: `if (action.status === "failed") return NextResponse.json({ ok: false, error: action.result?.error ?? "Action failed" }, { status: 502 });`.

---

### Finding 4 — LOW: `undoAction` check-then-act race allows double reversal for move/rename (benign in practice)

**Severity:** LOW — "minor perf, no user-visible impact" for the common case (Severity Rubric: LOW weight 1). The double-call to `updateItem` with the same `priorParentId`/`priorName` is idempotent at the Graph API level (same destination or same name = no-op), so no data corruption results.

**Evidence chain:**

`src/lib/agents/pendingActions.ts:240-243` — `const action = await getPendingAction(id, principal); if (!action) ...; if (action.status !== "confirmed") { return ...; }` — read-then-check.

`src/lib/agents/pendingActions.ts:256` and `:267` — `await updateItem(connId, itemId, { newParentId: priorParentId });` / `await updateItem(connId, itemId, { newName: priorName });` — side-effect before the DB status update.

`src/lib/agents/pendingActions.ts:302-308` — `.update({ status: "undone" }).eq("id", id).eq("principal", principal).eq("status", "confirmed")` — DB guard on the UPDATE, not on the side-effect call.

**Why LOW and not MEDIUM:** Unlike the confirm race (which can silently send a duplicate email), the undo race for `move_item`/`rename_item` calls `updateItem` twice with the same parameters. The Graph API returns success for both (idempotent). For `schedule_email` undo, the second `cancelScheduled` call throws (already cancelled), which is caught at line 289 and returns `{undone: false, reason: "already cancelled"}` — this is handled correctly. For `delete_item` undo, the path returns early before any side-effect (`undone: false, reason: "delete undo is unavailable"`). No tool in the undo path has a harmful double-fire consequence.

---

### Bypass Gate Audit — No Bypass Found

**DESTRUCTIVE set completeness:** All five tools named in the plan (`send_email`, `schedule_email`, `delete_item`, `move_item`, `rename_item`) are in the set at `onedriveTools.ts:564-570`. No casing variants, no aliases, no name collisions. Tool names in `TOOL_DEFINITIONS` are lowercase strings; `executeTool` receives `name` directly from the model call — no normalization step that could be exploited with `SEND_EMAIL` or `Send_Email`. Verified by tracing from `src/app/api/chat/route.ts` through the model response handler to `executeTool`.

**`create_folder` inline safety confirmed:** `src/lib/agents/onedriveTools.ts:667-679` — creates a folder in OneDrive. Additive, non-destructive (does not modify or delete existing items). No email side-effect. Inline execution is correct per ADR-003 §1.

**`cancel_scheduled_email` inline analysis:** As documented in Finding 1 — this tool has a principal isolation gap. It is NOT a bypass of the DESTRUCTIVE gate (it was never in the gate's scope), but it is a missing isolation guard on a mutating operation.

**`executeConfirmedAction` import scope:** `src/lib/agents/executeConfirmedAction.ts` is imported only in `src/lib/agents/pendingActions.ts:5`. Zero imports in `src/app/` — verified by grep. The confirm route calls `confirmAction`, not `executeConfirmedAction` directly. The enforcement boundary is intact.

**Principal injection via model args:** `src/lib/agents/onedriveTools.ts:613-617` — `stagePendingAction({ principal: sessionPrincipal, ... })` — `sessionPrincipal` is the parameter passed from the caller (the chat route), not from `args`. Verified that `args.principal` is never read in the DESTRUCTIVE gate. A model that supplies `{ principal: "Wency" }` in its tool call args cannot override the session principal.

**`_principal` unused in `executeConfirmedAction`:** `src/lib/agents/executeConfirmedAction.ts:37` — `// eslint-disable-next-line @typescript-eslint/no-unused-vars` / `_principal: string` — the principal parameter is accepted but unused. The OneDrive connection is resolved via `resolveConnectionId()` (no principal keying) and mail accounts via `loadAccountWithSecretByEmail(from)` (keyed by email address, not session principal). This is an acceptable architectural choice in a single-OneDrive, two-operator system where both operators share the same OneDrive tenant — the connection is the tenant connection, not per-operator. If the system later adds per-operator OneDrive connections, this parameter becomes load-bearing. Not a current security issue; the isolation is at the `pending_actions` row level (who staged the action), not at the connection resolution level.

**Injection via `summary` rendering:** `src/app/page.tsx:577` — `<p className="action-summary">{a.summary}</p>` — React text node, not `dangerouslySetInnerHTML`. Zero uses of `dangerouslySetInnerHTML` in the file (confirmed by grep returning no results). Prompt-injected content in `args` that flows into `summarizeAction` at `onedriveTools.ts:573-589` is rendered as escaped text. No injection risk.

**Auth on all four routes confirmed:** Each route reads `getPrincipal(req)` as the first statement and returns 401 before any DB access if null. Verified at `route.ts:15-17`, `confirm/route.ts:19-22`, `cancel/route.ts:17-20`, `undo/route.ts:17-20`.

**Migration RLS confirmed:** `supabase/migrations/0010_pending_actions.sql` — RLS enabled, zero `create policy` statements. Table is inaccessible to anon/authenticated roles. Service-role client (`supabaseAdmin()`) is the only access path — correct.

---

### Summary Table

| # | Finding | Severity | File:line | Phase verdict impact |
|---|---------|----------|-----------|---------------------|
| 1 | `cancel_scheduled_email` runs inline without principal scoping — model can cancel any operator's scheduled email | MEDIUM | `onedriveTools.ts:717-722`, `scheduled.ts:119-135` | None (MEDIUM does not block phase pass per rubric) |
| 2 | `confirmAction` check-then-act race allows concurrent double side-effect (send_email sends twice) | MEDIUM | `pendingActions.ts:153-159`, `pendingActions.ts:179-191` | None |
| 3 | Confirm route returns 409 "not pending" when true status is "failed" | LOW | `confirm/route.ts:48-49` | None |
| 4 | `undoAction` check-then-act race — double reversal call, idempotent in practice | LOW | `pendingActions.ts:240-256` | None |

**No CRITICAL or HIGH findings.** The primary ADR-003 goal — structural enforcement preventing the model from executing destructive tools without human confirmation — is intact. The DESTRUCTIVE gate has no bypass path. All five tools are correctly gated. Principal isolation on `pending_actions` rows is complete. The two MEDIUM findings are gaps adjacent to the gate (an ungated mutating tool with missing principal scoping, and a non-atomic confirm execution), neither of which allows the model to execute the five protected destructive tools without human confirmation.

**Recommended follow-on tasks for Phase 4 or a hardening sprint:**
1. Add `.eq("created_by", principal)` to `cancelScheduled` or gate `cancel_scheduled_email` in DESTRUCTIVE (Finding 1).
2. Replace the check-then-act pattern in `confirmAction` with an atomic `UPDATE ... WHERE status='pending' RETURNING *` RPC to eliminate the double-fire window (Finding 2).
