---
phase: 3
goal: "Destructive tool calls are gated by a HARD enforced confirmation (not prose), with undo where the platform allows and a principal-scoped auditable record."
tasks: 5
waves: 3
---

# Phase 3: Confirm / Undo on Destructive Actions

**Goal:** Destructive tools (`send_email`, `schedule_email`, `delete_item`, `move_item`, `rename_item`) NEVER execute inside the model's tool loop. `executeTool` stages a `pending_actions` row (principal from the verified session, never model args) and returns `{ status: "confirmation_required", action_id, summary }`. The real side-effects move into `executeConfirmedAction`, called ONLY by the confirm endpoint. New `/api/actions` endpoints (list/confirm/cancel/undo) are principal-scoped + 401 without a session. A chat pending-action card lets the operator Confirm / Cancel / Undo.

**Why this phase:** Today destructive side-effects run immediately inside the tool loop (`onedriveTools.ts:629-652,676-697,700-731`) guarded only by system-prompt prose (`client.ts:95-122`). A prompt-injected document or email could steer the model to delete OneDrive files or send company mail with no human in the loop. Stage-and-confirm makes the confirmation structural — the model has no code path to the side-effect (ADR-003).

---

## Task 1 — Migration: `pending_actions` table
**Wave:** 1
**Persona:** backend
**Files:** create `supabase/migrations/0010_pending_actions.sql`
**Depends on:** none

**Why:** ADR-003 §6 / AC2 require a principal-scoped, service-role-only audit store that doubles as the staging table and the audit record (status lifecycle + timestamps + result). No second log table (ADR-003 alternative rejected).

**Acceptance Criteria:**
- A `public.pending_actions` table exists with: `id uuid pk default gen_random_uuid()`, `principal text not null check (principal in ('Wency','Jeanette'))`, `tool text not null`, `args jsonb not null`, `summary text not null`, `status text not null default 'pending' check (status in ('pending','confirmed','cancelled','undone','failed'))`, `undo_data jsonb`, `result jsonb`, `created_at timestamptz not null default now()`, `resolved_at timestamptz`.
- RLS is enabled with NO policies (service-role only), matching `0009_memory_facts.sql:41` and `0004_chat_messages.sql:22`.
- An index `idx_pending_actions_principal_status_created` on `(principal, status, created_at)` for the UI's principal-scoped pending list.
- File header comment states: service-role-only, principal check enforces REQ-3 at schema level, applied via CI never hand-applied (constitution).

**Action:** Mirror `supabase/migrations/0009_memory_facts.sql` exactly for structure (table → comment → indexes → `alter table … enable row level security;`). The `principal in ('Wency','Jeanette')` check is copied verbatim from `0009:17`. Do NOT add `create policy` statements — RLS-on-no-policy is the lockdown. Status enum check must list all five states. `args` and `undo_data` and `result` are `jsonb`.

**Validation:** (builder self-check)
- `test -f supabase/migrations/0010_pending_actions.sql && echo EXISTS` → `EXISTS`
- `grep -c "enable row level security" supabase/migrations/0010_pending_actions.sql` → `1`
- `grep -c "create policy" supabase/migrations/0010_pending_actions.sql` → `0`
- `grep -c "principal in ('Wency', 'Jeanette')" supabase/migrations/0010_pending_actions.sql` → `1`

**Context:** Read @supabase/migrations/0009_memory_facts.sql @supabase/migrations/0004_chat_messages.sql @.planning/decisions/ADR-003-enforced-confirm-undo.md

---

## Task 2 — Stage destructive tools + extract `executeConfirmedAction`
**Wave:** 1
**Persona:** security
__T2FILES__ (exports `stagePendingAction`, `getPendingAction`, `listPendingActions`, `confirmAction`, `cancelAction`, `undoAction`, and types `PendingAction`, `PendingStatus`)
- create `src/lib/agents/executeConfirmedAction.ts` (exports `executeConfirmedAction(tool, args, principal)`)
- modify `src/lib/agents/onedriveTools.ts` (gate the destructive set in `executeTool`)
- modify `src/lib/microsoft/onedrive.ts` (add `parentId?: string` to the mapped `DriveItem` so undo can capture prior parent)
- modify `src/lib/microsoft/types.ts` (add `parentId?: string` to `DriveItem`)
**Depends on:** none (T1 migration is a runtime prerequisite applied via CI separately; no build-time file edge — both run in Wave 1)

**Why:** This is the enforcement core (ADR-003 §2, §3 / AC1, AC2). The model must have NO code path to the side-effect. `executeTool` for the destructive set stages a row and returns `confirmation_required`; the real side-effects (Graph delete/update, SMTP send, schedule insert) live ONLY in `executeConfirmedAction`, which the tool loop never calls.

**Acceptance Criteria:**
- Calling `executeTool("delete_item"/"send_email"/"move_item"/"rename_item"/"schedule_email", args, null, "Wency")` inserts a `pending_actions` row (principal `"Wency"`, the tool, args, a human-readable `summary`, status `pending`) and returns `{ status: "confirmation_required", action_id, summary }` — and NONE of `deleteItem`/`sendMail`/`updateItem`/`scheduleEmail` is called.
- Calling a destructive tool with NO `sessionPrincipal` returns `{ error: "no verified principal in session" }` and stages nothing (fail-closed, mirroring `recall_memory` at `onedriveTools.ts:669`).
- `create_folder` (`onedriveTools.ts:615`) and all read-only tools are UNCHANGED — they still execute inline.
- `executeConfirmedAction("move_item"/"rename_item", args, principal)` captures the item's CURRENT `parentId`/`name` (via `getItem`) into the returned undo_data BEFORE calling `updateItem`; `delete_item` returns undo_data `{ kind: "recycle" }`; `send_email` returns `{ undoable: false }`; `schedule_email` returns the queued row id for undo.
- `npx tsc --noEmit` exits 0.

**Action:**
1. In `src/lib/microsoft/types.ts` add `parentId?: string;` to `DriveItem`. In `src/lib/microsoft/onedrive.ts`, in the `map()` function, set `parentId: raw.parentReference?.id` (the raw already selects `parentReference` — `onedrive.ts:20`). Additive, non-breaking.
2. Create `src/lib/agents/pendingActions.ts` using `supabaseAdmin()` from `@/lib/supabase/server` against table `"pending_actions"`. Mirror the row↔camelCase mapping + service-role + status-guard pattern from `src/lib/mail/scheduled.ts` (`scheduleEmail`/`cancelScheduled`/`listScheduled`). Functions:
   - `stagePendingAction({ principal, tool, args, summary })` → insert status `pending`, return the `PendingAction`.
   - `listPendingActions(principal)` → `.eq("principal", principal).eq("status","pending").order("created_at",{ascending:false})`.
   - `getPendingAction(id, principal)` → single row `.eq("id",id).eq("principal",principal)` (REQ-3 isolation; returns null if not found).
   - `confirmAction(id, principal)` → status-guarded: `.update({status:"confirmed", resolved_at, result, undo_data}).eq("id",id).eq("principal",principal).eq("status","pending")` so re-confirm of an already-`confirmed`/`cancelled` row updates 0 rows (idempotency, AC6). The function fetches the pending row first (principal-scoped), calls `executeConfirmedAction(tool, args, principal)`, then writes `result` + `undo_data` + status; on `executeConfirmedAction` throw, set status `failed` + `result.error`.
   - `cancelAction(id, principal)` → `.update({status:"cancelled", resolved_at}).eq("id",id).eq("principal",principal).eq("status","pending")`.
   - `undoAction(id, principal)` → fetch row principal-scoped; only `status==="confirmed"` is undoable; dispatch by `tool` using stored `undo_data` (move/rename → `updateItem(connId, itemId, { newParentId/newName: undo_data.priorParentId/priorName })`; delete → best-effort restore, report unavailable; schedule → `cancelScheduled(undo_data.scheduledId)` if still pending; send → return `{ undone: false, reason: "send is irreversible" }`). On success set status `undone`.
3. Create `src/lib/agents/executeConfirmedAction.ts`: move the CURRENT case bodies of `move_item`(`onedriveTools.ts:629-636`), `rename_item`(`:638-645`), `delete_item`(`:647-652`), `send_email`(`:676-697`), `schedule_email`(`:700-731`) here, keyed by `tool`. For move/rename, call `getItem(connId, { itemId })` first and return `undo_data` `{ priorParentId, priorName }`. Resolve `connId` via `resolveConnectionId` for OneDrive tools (same as `executeTool`). Signature returns `{ result, undo_data }`.
4. In `src/lib/agents/onedriveTools.ts` `executeTool`: replace the 5 destructive case BODIES with a single gate. Define `const DESTRUCTIVE = new Set(["send_email","schedule_email","delete_item","move_item","rename_item"]);`. At the top of the `switch` (or before it), if `DESTRUCTIVE.has(name)`: fail-closed if `!sessionPrincipal`; build a `summary` from args (e.g. `Delete file ${args.itemId}`, `Send email to ${args.to} — "${args.subject}"`); call `stagePendingAction(...)`; return `JSON.stringify({ status: "confirmation_required", action_id: row.id, summary })`. Remove the now-dead imports that are ONLY used by the extracted bodies (e.g. `sendMail`, `scheduleEmail`) IF no longer referenced in this file — leave `updateItem`/`deleteItem`/etc. imports in `executeConfirmedAction.ts`. `cancel_scheduled_email` (`:748`) and `list_scheduled_emails` stay inline (not in the destructive set per ADR-003 §1).

**Validation:** (builder self-check)
- `grep -c "confirmation_required" src/lib/agents/onedriveTools.ts` → ≥ 1
- `grep -c "export async function executeConfirmedAction" src/lib/agents/executeConfirmedAction.ts` → `1`
- `grep -c "sendMail\|deleteItemOnDrive\|scheduleEmail" src/lib/agents/onedriveTools.ts` → `0` (side-effects gone from the tool loop)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/agents/onedriveTools.ts @src/lib/mail/scheduled.ts @src/lib/supabase/server.ts @src/lib/microsoft/onedrive.ts @src/lib/microsoft/types.ts @.planning/decisions/ADR-003-enforced-confirm-undo.md

---

## Task 3 — `/api/actions` endpoints (list / confirm / cancel / undo)
**Wave:** 2
**Persona:** backend
**Files:**
- create `src/app/api/actions/route.ts` (GET — list pending for the session principal)
- create `src/app/api/actions/confirm/route.ts` (POST `{ id }`)
- create `src/app/api/actions/cancel/route.ts` (POST `{ id }`)
- create `src/app/api/actions/undo/route.ts` (POST `{ id }`)
**Depends on:** Task 2

**Why:** ADR-003 §4 / AC3, AC4, AC5, AC6 — the human-triggered surface. Confirm is the ONLY caller of `executeConfirmedAction`. Every route derives the principal from the session (never the body) and is principal-scoped so one operator cannot act on another's action.

**Acceptance Criteria:**
- All four routes return 401 when `getPrincipal(req)` is null (mirror `src/app/api/chat/route.ts:19-22`).
- `GET /api/actions` returns `{ ok: true, data: { actions: [...] } }` — only the session principal's `pending` rows (via `listPendingActions(principal)`).
- `POST /api/actions/confirm { id }` calls `confirmAction(id, principal)`, which runs `executeConfirmedAction` and records `result`/`resolved_at`/`status:'confirmed'`. A re-confirm of an already-resolved id is a no-op (0 rows updated → return `{ ok: false, error: "not pending" }`, 409).
- `POST /api/actions/cancel { id }` calls `cancelAction(id, principal)`; sets status `cancelled`; no side-effect.
- `POST /api/actions/undo { id }` calls `undoAction(id, principal)`; reverses reversible confirmed actions; `send_email` reports no-undo.
- Acting on an id belonging to another principal returns 404 (the principal-scoped query finds no row).
- `npx tsc --noEmit` exits 0.

**Action:** Each route: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` (match `chat/route.ts:6-7`). Start each handler with `const principal = getPrincipal(req); if (!principal) return NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 });`. POST routes parse `{ id }` from the body with a try/catch returning 400 on bad JSON and 400 if `id` missing. Call the matching `pendingActions.ts` function with `(id, principal)`. Map a null/0-row result to 404 (`{ ok:false, error:"Action not found" }`) and an already-resolved confirm to 409. Wrap side-effecting calls in try/catch → 502 with the error message (match `chat/route.ts:59-62`). Use `NextRequest`/`NextResponse` from `next/server`. Import `getPrincipal` from `@/lib/auth/session`.

**Validation:** (builder self-check)
- `grep -rc "getPrincipal" src/app/api/actions/` → each file ≥ 1
- `grep -c "confirmAction" src/app/api/actions/confirm/route.ts` → `1`
- `grep -c "executeConfirmedAction" src/app/api/actions/confirm/route.ts` → `0` (confirm calls it via `confirmAction`, not directly — enforcement boundary stays in the agents layer)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/api/chat/route.ts @src/lib/auth/session.ts @src/lib/agents/pendingActions.ts @.planning/decisions/ADR-003-enforced-confirm-undo.md

---

## Task 4 — Chat pending-action card (Confirm / Cancel / Undo)
**Wave:** 2
**Persona:** frontend
**Files:**
- modify `src/app/page.tsx` (poll `/api/actions` and render a pending-action card; wire confirm/cancel/undo)
- modify `src/app/globals.css` (add `.action-card` + state styles using existing tokens)
**Depends on:** Task 2 (imports the `PendingAction` type; reaches the routes only at runtime via fetch)

**Why:** ADR-003 §7 / AC7 — the operator-facing surface. The SSE stream parser stays UNCHANGED; the UI fetches pending actions out-of-band. Without this card the staged actions are invisible and the model's `confirmation_required` reply is a dead end.

**Acceptance Criteria:**
- After the model replies (end of `send()`), and on identity mount, the chat fetches `GET /api/actions` and renders a card per pending action showing the `summary`, a **Confirm** and a **Cancel** button.
- Confirm → `POST /api/actions/confirm {id}`; on success the card shows a confirmed state, and for a reversible tool (`move_item`/`rename_item`/`delete_item`/`schedule_email`) an **Undo** button appears; `send_email` shows "sent — cannot undo".
- Cancel → `POST /api/actions/cancel {id}`; card disappears from the pending list.
- Undo → `POST /api/actions/undo {id}`; card shows undone state on success, error state on failure.
- The card has loading (button spinner during the POST), error (inline `.notice.err`), and empty (no card when no pending actions) states.
- No raw hex / no `#fff`/`#000`; uses existing OKLCH tokens. The SSE parse loop (`page.tsx:247-272`) is byte-for-byte unchanged.
- `npx tsc --noEmit` exits 0.

**Action:** Add state `const [pending, setPending] = useState<PendingAction[]>([])` and `const [actionBusy, setActionBusy] = useState<string|null>(null)`. Add `async function loadPending()` → `fetch("/api/actions")` → `setPending(json.data.actions)`; call it at the end of `send()` after `persist(...)` and inside the identity `useEffect`. Add `confirm(id)`/`cancelAction(id)`/`undo(id)` handlers that POST to the matching route, set `actionBusy`, and `loadPending()` on completion. Render the card list ABOVE the composer (after the `.thread` div, `page.tsx:471`). Reuse `.btn` / `.btn.ghost` / `.btn.danger` and the `spinner` class already in the file (`page.tsx:493`). Do NOT touch the streaming reader.

**Validation:** (builder self-check)
- `grep -c "/api/actions" src/app/page.tsx` → ≥ 1
- `grep -c "action-card" src/app/page.tsx` → ≥ 1
- `grep -c "action-card" src/app/globals.css` → ≥ 1
- `grep -cE "#fff|#000|#[0-9a-fA-F]{3,6}" src/app/globals.css` against the lines you added → 0 (no new hex)
- `node /home/moayad-qualia/.claude/bin/slop-detect.mjs src/app/page.tsx` → no critical findings
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Design:**
- Register: brand (existing maritime operations-console system)
- Tokens used: `var(--surface-2)`, `var(--border)`, `var(--text)`, `var(--text-dim)`, `var(--accent)`/`var(--accent-hover)`, `var(--danger)`/`var(--danger-subtle)` (Cancel), `var(--success)`/`var(--success-subtle)` (confirmed), `var(--radius)`, `--sp-3`/`--sp-4`, `var(--font-mono)` for the action `tool`/id metadata, `var(--transition-base)`
- Scope: component (a card inside the existing chat surface)
- Anti-pattern guard: builder runs `node /home/moayad-qualia/.claude/bin/slop-detect.mjs src/app/page.tsx` pre-commit; commit blocked on critical findings. Verify against `.planning/DESIGN.md §10` checklist (no #000/#fff, mono metadata, 44px targets, reduced-motion honored on any new animation).

**Context:** Read @src/app/page.tsx @src/app/globals.css @.planning/DESIGN.md @src/lib/agents/pendingActions.ts

---

## Task 5 — System prompt update + seam/route tests
**Wave:** 3
**Persona:** backend
**Files:**
- modify `src/lib/openrouter/client.ts` (rewrite the confirm prose, `:95-122`)
- modify `src/lib/agents/onedriveTools.test.ts` (add staging assertions)
- create `src/app/api/actions/confirm/route.test.ts` (confirm/auth/isolation/idempotency, mocked)
**Depends on:** Task 2, Task 3

**Why:** ADR-003 §2 consequence (the old "wait for explicit confirmation then call the tool" prose is now misleading) + AC8 (tsc + suite green) + AC1/AC3/AC4/AC6 need automated seam coverage. The prompt must describe destructive tools as "staged for confirmation" so the model relays the summary and stops rather than expecting to call the tool after a yes.

**Acceptance Criteria:**
- The system prompt (`client.ts:95-122`) no longer instructs the model to "wait for their EXPLICIT confirmation … then call send_email"; it states destructive tools (send/schedule/delete/move/rename) are AUTOMATICALLY staged for the user's confirmation in the UI — the model proposes the action, calls the tool once, and relays the returned summary; it does NOT re-call after a yes.
- A new test asserts `executeTool("delete_item", {...}, null, "Wency")` returns `status:"confirmation_required"` and that the mocked `deleteItem` adapter was NOT called (AC1), and that `stagePendingAction` (mocked) was called with principal `"Wency"` (AC2).
- A route test for `/api/actions/confirm` asserts: 401 without principal (AC4); 404 for another principal's id (AC4); confirm runs `executeConfirmedAction` and sets `confirmed` (AC3); a second confirm of the same id does not re-run the side-effect (AC6) — all with `pendingActions`/`getPrincipal` mocked.
- `npx vitest run` passes (existing + new); `npx tsc --noEmit` exits 0.

**Action:**
1. Rewrite `client.ts` system-prompt items 4, 5b, and 6 (`:95-121`): replace the "wait for explicit confirmation, then call the tool" language with "These actions are staged for the user's confirmation automatically — propose the action, call the tool, and relay the `summary` it returns. The user confirms in the app; do NOT call the tool a second time." Keep the read-only-is-safe sentence (`:106-108`).
2. In `src/lib/agents/onedriveTools.test.ts`: add `vi.mock("@/lib/agents/pendingActions", () => ({ stagePendingAction: vi.fn(async () => ({ id: "pa-1", summary: "Delete X" })) }))` and a `describe("destructive gating")` with the AC1/AC2 assertions above. The existing `@/lib/microsoft/onedrive` mock (`onedriveTools.test.ts:9`) already stubs `deleteItem`/`updateItem` — assert `not.toHaveBeenCalled()`.
3. Create `src/app/api/actions/confirm/route.test.ts` mocking `@/lib/auth/session` (`getPrincipal`) and `@/lib/agents/pendingActions` (`confirmAction`). Build a fake `NextRequest` with a JSON body. Assert the four cases. Follow the seam-test mock style from `onedriveTools.test.ts:9-50`.

**Validation:** (builder self-check)
- `grep -c "wait for their EXPLICIT confirmation" src/lib/openrouter/client.ts` → `0`
- `grep -c "staged" src/lib/openrouter/client.ts` → ≥ 1
- `npx vitest run 2>&1 | grep -cE "FAIL|failed"` → `0`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/openrouter/client.ts @src/lib/agents/onedriveTools.test.ts @src/lib/agents/pendingActions.ts @src/app/api/actions/confirm/route.ts

---

## Success Criteria
- [ ] **AC1** — `executeTool` for any destructive tool returns `confirmation_required` and calls NO adapter side-effect (Task 2, Task 5).
- [ ] **AC2** — Staging persists a principal-scoped `pending_actions` row (status `pending`) (Task 1, Task 2).
- [ ] **AC3** — `POST /api/actions/confirm` runs `executeConfirmedAction`, sets `confirmed`, records `resolved_at`/`result` (Task 3, Task 5).
- [ ] **AC4** — All `/api/actions` routes 401 without a session; principal isolation prevents cross-principal confirm/cancel/undo (Task 3, Task 5).
- [ ] **AC5** — Undo reverses `move_item`/`rename_item` via `updateItem` from `undo_data`; `send_email` reports no-undo (Task 2, Task 3).
- [ ] **AC6** — Confirming an already-resolved action does not re-execute (Task 2, Task 3, Task 5).
- [ ] **AC7** — Chat surfaces pending actions with Confirm/Cancel (and Undo after reversible confirm), token-driven, with loading/error/empty states, passes slop-detect (Task 4).
- [ ] **AC8** — `npx tsc --noEmit` 0; `npx vitest run` passes (Task 2-5).

---

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0010_pending_actions.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — RLS on, no policy (AC2 lockdown)
**Check type:** command-exit
**Command:** `grep -c "enable row level security" supabase/migrations/0010_pending_actions.sql; grep -c "create policy" supabase/migrations/0010_pending_actions.sql`
**Expected:** first `1`, second `0`
**Fail if:** RLS missing OR any policy present (would expose the table to anon/authenticated)

### Contract for Task 1 — status enum + principal check
**Check type:** grep-match
**Command:** `grep -cE "status in \('pending','confirmed','cancelled','undone','failed'\)|status in \('pending', 'confirmed'" supabase/migrations/0010_pending_actions.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — status lifecycle not constrained

### Contract for Task 2 — destructive set returns confirmation_required (AC1)
**Check type:** grep-match
**Command:** `grep -c "confirmation_required" src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — destructive tools still execute inline

### Contract for Task 2 — side-effects removed from tool loop (AC1)
**Check type:** command-exit
**Command:** `grep -c "sendMail\|deleteItemOnDrive\|scheduleEmail" src/lib/agents/onedriveTools.ts`
**Expected:** `0`
**Fail if:** Non-zero — a destructive adapter is still reachable from `executeTool`

### Contract for Task 2 — executeConfirmedAction exists (AC3 wiring source)
**Check type:** grep-match
**Command:** `grep -c "export async function executeConfirmedAction" src/lib/agents/executeConfirmedAction.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the confirm path has nothing to call

### Contract for Task 2 — staging is principal-scoped (AC2)
**Check type:** grep-match
**Command:** `grep -c "stagePendingAction" src/lib/agents/onedriveTools.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — destructive tools do not stage a row

### Contract for Task 3 — all action routes guard the session (AC4)
**Check type:** command-exit
**Command:** `for f in src/app/api/actions/route.ts src/app/api/actions/confirm/route.ts src/app/api/actions/cancel/route.ts src/app/api/actions/undo/route.ts; do grep -q getPrincipal "$f" || echo "MISSING:$f"; done`
**Expected:** no output (every route imports/uses getPrincipal)
**Fail if:** Any `MISSING:` line — that route is unauthenticated

### Contract for Task 3 — confirm route wires to confirmAction (AC3 wiring)
**Check type:** grep-match
**Command:** `grep -c "confirmAction" src/app/api/actions/confirm/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — confirm endpoint does not invoke the confirmed-action path

### Contract for Task 3 — undo route wires to undoAction (AC5 wiring)
**Check type:** grep-match
**Command:** `grep -c "undoAction" src/app/api/actions/undo/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — undo endpoint does nothing

### Contract for Task 4 — pending-action card rendered in chat (AC7 wiring)
**Check type:** grep-match
**Command:** `grep -c "action-card" src/app/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — staged actions are invisible to the operator

### Contract for Task 4 — UI fetches actions out-of-band (AC7)
**Check type:** grep-match
**Command:** `grep -c "/api/actions" src/app/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — card has no data source

### Contract for Task 4 — no raw hex in added CSS (AC7 / DESIGN §10)
**Check type:** command-exit
**Command:** `node /home/moayad-qualia/.claude/bin/slop-detect.mjs src/app/page.tsx`
**Expected:** no critical findings
**Fail if:** slop-detect reports a critical finding

### Contract for Task 5 — confirm prose replaced (ADR-003 §2 consequence)
**Check type:** command-exit
**Command:** `grep -c "wait for their EXPLICIT confirmation" src/lib/openrouter/client.ts; grep -c "staged" src/lib/openrouter/client.ts`
**Expected:** first `0`, second ≥ 1
**Fail if:** Old prose remains OR "staged" language absent

### Contract for Task 5 — suite + tsc green (AC8)
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"; npx vitest run 2>&1 | grep -cE "FAIL|failed"`
**Expected:** both `0`
**Fail if:** Any TS error or any failing test

### Contract for Task 5 — AC1/AC2 seam test present
**Check type:** grep-match
**Command:** `grep -c "confirmation_required" src/lib/agents/onedriveTools.test.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no automated proof destructive tools stage instead of execute
