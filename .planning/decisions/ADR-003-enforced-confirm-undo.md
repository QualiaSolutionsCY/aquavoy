# ADR-003 — Enforced Confirm / Undo on Destructive Actions (M2 · Phase 3)

**Date:** 2026-06-17
**Status:** Accepted
**Deciders:** Moayad (EMPLOYEE) — OWNER ratification on first ship
**Touches:** `src/lib/agents/onedriveTools.ts`, `src/lib/openrouter/client.ts`, new `src/app/api/actions/*`, new migration, chat UI

## Context

Destructive tool calls execute **immediately** inside `executeTool` (`onedriveTools.ts` cases:
`send_email:676`, `schedule_email:700`, `delete_item:647`, `move_item:629`, `rename_item:638`).
The only guard is system-prompt prose (`client.ts:95-122`, "ALWAYS … wait for explicit
confirmation"). An LLM can ignore that, and a prompt-injected document/email could steer it to
send company mail or delete OneDrive files with no human in the loop. There is no audit trail.

ROADMAP M2-P3 requires: (1) an enforced confirmation the model **cannot skip** (structured, not
prose), (2) undo where the platform allows / the confirm-as-guard + logging where it doesn't,
(3) an auditable who/what/when record scoped to the session principal.

The fork: how do you make confirmation enforced rather than prose-dependent, in a server-side
streaming tool-loop?

## Decision

**Stage-and-confirm: destructive tools NEVER execute inside the model's tool loop. They are staged
as pending actions; the side-effect runs only via a separate human-triggered endpoint.**

1. **Destructive set (gated):** `send_email`, `schedule_email`, `delete_item`, `move_item`,
   `rename_item`. (`create_folder` is additive/low-risk — not gated. Read-only tools unaffected.)
2. **`executeTool` gates the set.** For a destructive tool it does NOT perform the side-effect.
   It inserts a `pending_actions` row (principal from the verified session — ADR-001/REQ-3, never
   from model args) with a human-readable `summary`, and returns a structured
   `{ status: "confirmation_required", action_id, summary }` to the model. The model relays the
   summary to the user and stops. **The model has no code path to the side-effect** — this is the
   enforcement (not prose).
3. **The real side-effect is extracted into `executeConfirmedAction(tool, args, principal)`** in
   the agents layer, called ONLY by the confirm endpoint — never by the tool loop.
4. **Human-triggered endpoints** (principal from session cookie, scoped):
   - `GET  /api/actions?status=pending` — list the principal's pending actions for the UI.
   - `POST /api/actions/confirm { id }` — run `executeConfirmedAction`, record result +
     reversibility, set status `confirmed`.
   - `POST /api/actions/cancel  { id }` — set status `cancelled`, no side-effect.
   - `POST /api/actions/undo    { id }` — reverse a reversible confirmed action.
5. **Undo policy by tool:** `move_item`/`rename_item` → store prior `parentId`/`name` in
   `undo_data`, reverse via `updateItem`. `delete_item` → Graph delete goes to recycle;
   undo attempts best-effort restore and reports if unavailable. `schedule_email` → undo =
   cancel the queued row if not yet sent. `send_email` → **no undo** (irreversible); the confirm
   IS the guard and the send is logged.
6. **Audit = the `pending_actions` table itself** (status transitions + timestamps + result):
   who (`principal`), what (`tool` + `args` + `summary`), when (`created_at`, `resolved_at`),
   outcome (`status`, `result`). Scoped to principal; service-role only (RLS on, no policies).
7. **UI surface:** a pending-action card in the chat (Confirm / Cancel; Undo after a reversible
   confirm), styled with the existing OKLCH dark-ocean tokens. The SSE stream parser is unchanged;
   the UI fetches pending actions out-of-band (the existing comment that the stream parser stays
   unchanged is preserved).

## Alternatives considered

- **`confirm_action(token)` tool the model calls after the user says "yes".** Rejected — the model
  can call it itself (or be injected to), so it is not enforced; it is prose with extra steps.
- **Keep execution in the loop, add a stronger system prompt.** Rejected — that is the status quo;
  prose is exactly what the phase must replace.
- **Separate `action_log` audit table + `pending_actions`.** Rejected for MVP — one table with a
  status lifecycle is the auditable record; a second table is redundant at two-operator scale.

## Consequences

- New migration `0010_pending_actions.sql`: `pending_actions` (id, principal check, tool, args
  jsonb, summary, status check `pending|confirmed|cancelled|undone|failed`, undo_data jsonb,
  result jsonb, created_at, resolved_at). RLS on, no policies; principal-scoped queries (REQ-3).
- `executeTool` gains a destructive-gate branch; the real side-effects move to
  `executeConfirmedAction`. The tool-loop never mutates external systems directly again.
- New `src/app/api/actions/` routes (list/confirm/cancel/undo), principal from session, 401 when absent.
- New chat UI pending-action control (Confirm/Cancel/Undo) using existing design tokens.
- System prompt updated: destructive tools are described as "staged for the user's confirmation",
  removing the now-misleading "wait for explicit confirmation then call the tool" prose.
- Reversible-ish: the gate + endpoints are additive; the tool contracts (names/args) are unchanged,
  so the model's view of the tools is stable.
