# Phase 1 Plan · M5 Recurring Scheduling

**Milestone:** 5 — Client Meeting Build
**Phase:** 1 of 4 — Recurring Scheduling (A15)
**Goal:** Scheduled emails and tasks can repeat (none/daily/weekly/monthly) so Wency's
"5th of every month, send the invoices to the accountant" recurs instead of firing once.

## Task 1 — Recurrence schema
Migration `0014` — additive `recurrence` + `recurrence_until` on `scheduled_emails` and
`scheduled_tasks` (CHECK-constrained, default `none` = backward compatible).
**Done when:** both tables have the columns; default `none`; no data loss.

## Task 2 — Recurrence helper
`src/lib/scheduleRecurrence.ts` — pure `nextOccurrence()` with month-end clamp + unit tests.
**Done when:** daily/weekly/monthly + Jan31→Feb clamp covered by passing tests.

## Task 3 — Runner re-queue
`runDue` / `runDueTasks` re-queue recurring rows (advance `scheduled_at`, status back to
`pending`); `none` still finalizes as `sent`.
**Done when:** a recurring row re-queues; non-recurring still marks `sent`.

## Task 4 — Agent tools + wiring
`schedule_email` / `schedule_task` expose a `recurrence` param; `executeConfirmedAction`
forwards it for the staged email path.
**Done when:** agent-scheduled recurring email persists its recurrence (no silent `none`).

## Task 5 — UI badge
Recurrence cadence badge in the scheduled-emails panel.
**Done when:** each scheduled row shows One-time/Daily/Weekly/Monthly defensively.

## Acceptance Criteria
- A recurring schedule re-queues to its next occurrence; non-recurring behavior unchanged.
- `tsc --noEmit` clean; full unit suite green.

Detailed source: `.planning/m5-phase1-scope.md`. Adjacent decision: ADR-005.
