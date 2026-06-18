---
phase: 3
milestone: 2
archetype: ai-agent
profile: standard
scoped_by: Moayad
scoped_at: 2026-06-17
decision_ref: ADR-003
---

# Phase 3 — Confirm / Undo on Destructive Actions · Scope

**Goal:** Destructive tool calls (send email, delete/move/rename file, schedule email) are gated by
a HARD, enforced confirmation — not prose the model can skip — with undo where the platform allows
and an auditable record of every destructive action.

**Approach (locked, ADR-003):** stage-and-confirm. Destructive tools never execute in the model's
tool loop; they are staged as `pending_actions` and executed only via a human-triggered endpoint.

## Grounded current state

- Destructive tools execute immediately in `executeTool` — `onedriveTools.ts`: `send_email:676`,
  `schedule_email:700`, `delete_item:647`, `move_item:629`, `rename_item:638`. Guard is prose only
  (`client.ts:95-122`).
- Tool loop: `streamChatWithTools` (`client.ts:264`) calls `executeTool(name, args, null, identity)`
  per tool call (`:337`) — `identity` is the HMAC-verified session principal.
- `deleteItem` (`microsoft/onedrive.ts:200`) → Graph DELETE (recycle). `updateItem` (`:208`) →
  reversible move/rename. No audit table exists.

## v1 capability set

1. `pending_actions` table (migration `0010`): principal-scoped, service-role-only, status lifecycle.
2. `executeTool` gates the destructive set → stages a pending action + returns `confirmation_required`; the real side-effect is extracted to `executeConfirmedAction(tool, args, principal)`.
3. `/api/actions` endpoints: list (pending), confirm, cancel, undo — principal from session, 401 without.
4. Undo: move/rename reverse via stored `undo_data`; delete best-effort restore; schedule cancel-if-unsent; send no-undo (logged).
5. Chat UI pending-action card (Confirm / Cancel / Undo) using existing OKLCH dark-ocean tokens.
6. System prompt updated to describe destructive tools as "staged for confirmation".

## Definition of Done (ai-agent archetype, this phase)

| DoD area | Resolution |
|---|---|
| Enforced confirm (model cannot skip) | Destructive side-effects removed from the tool loop; only `executeConfirmedAction` (called by the human endpoint) mutates. |
| Tools validated server-side | Confirm/cancel/undo derive principal from session, validate the action id + ownership. |
| Idempotency on writes | Confirm transitions `pending→confirmed` once; re-confirm is a no-op (status guard). |
| RLS / new table | `pending_actions`: RLS on, no policies (service-role); principal column + check constraint. |
| Principal isolation (REQ-3) | Every actions query `.eq("principal", sessionPrincipal)`; one operator cannot confirm/undo another's action. |
| Audit record (who/what/when) | `pending_actions` rows with principal, tool, args, summary, status, created_at, resolved_at, result. |
| Undo where platform allows | move/rename/delete/schedule per ADR-003 §5; send is no-undo + logged. |
| Frontend states | Pending card has confirm/cancel/undo + loading/error/empty/success states; existing design tokens. |

## Acceptance criteria (testable)

- **AC1 — No inline destructive execution:** calling `executeTool("delete_item"/"send_email"/… )`
  returns `{ status: "confirmation_required", action_id, summary }` and performs NO side-effect
  (the underlying adapter — `deleteItem`/`sendMail`/`updateItem` — is NOT called). *(Seam test, mocked.)*
- **AC2 — Staging persists a principal-scoped pending row:** staging inserts a `pending_actions`
  row with the session principal, the tool, args, a summary, status `pending`. *(Seam test.)*
- **AC3 — Confirm executes + logs:** `POST /api/actions/confirm` runs `executeConfirmedAction`
  (adapter IS called), sets status `confirmed`, records `resolved_at`/`result`. *(Route test, mocked.)*
- **AC4 — Auth + isolation:** all `/api/actions` routes 401 without a session; a principal cannot
  confirm/cancel/undo an action belonging to another principal (404/forbidden). *(Route test.)*
- **AC5 — Undo:** confirming then undoing a `move_item`/`rename_item` reverses it via `updateItem`
  using `undo_data`; `send_email` reports no-undo. *(Route test, mocked.)*
- **AC6 — Idempotent confirm:** confirming an already-confirmed/cancelled action does not re-execute. *(Route test.)*
- **AC7 — UI:** the chat surfaces pending actions with Confirm/Cancel controls (and Undo after a
  reversible confirm), using design tokens (no raw hex), with loading/error/empty states. Passes
  `slop-detect`. *(Browser QA env-gated; code + token review otherwise.)*
- **AC8 — tsc + suite green:** `npx tsc --noEmit` 0; `npx vitest run` passes (existing + new).

## Verification note (env-gated)

Live smoke (real Graph delete/restore, real send, the UI in a browser) is deferred — no Supabase /
Graph / `.env.local` this session. Build-time gates (tsc, vitest with mocked seams, slop-detect on
touched UI) are the primary validation; live smoke runs at ship.

## Gate

- [x] v1 capability set scoped
- [x] zero `[NEEDS CLARIFICATION]` markers
- [x] every DoD area resolved (none waived)
