# Phase 3 Plan · M5 Finance Views

**Milestone:** 5 — Client Meeting Build
**Phase:** 3 of 4 — Finance Views (per ADR-005 hybrid storage)
**Goal:** Real consolidated + per-company expense/income — the "see our expenses and income"
ask. OneDrive stays the document store; Supabase holds the ledger index on top.

## Task 1 — Ledger schema
Migration `0015` — `finance_entries` (company, direction, amount, currency, doc_date, source
refs, status; RLS on, service-role only).
**Done when:** table exists with a direction CHECK and RLS enabled.

## Task 2 — Ledger lib
`src/lib/finance/ledger.ts` — `financeSummary` (per-company income/expense/net + consolidated,
all 8 companies zero-filled), `recordFinanceEntry`, `deleteFinanceEntry` + tests.
**Done when:** aggregation is correct and unit-tested.

## Task 3 — Confirm-gated record tool
`record_finance_entry` agent tool in the DESTRUCTIVE set; `executeConfirmedAction` inserts on
confirm; undo deletes the entry.
**Done when:** the agent stages an entry, the human confirms before it writes, and undo removes it.

## Task 4 — Finance dashboard
`GET /api/finance/summary` (principal-gated) + the finance tab overview: consolidated totals +
per-company cards, with empty/loading/error states.
**Done when:** the tab shows real numbers (or a friendly empty state), no regression to scan/action-stack.

## Acceptance Criteria
- Confirm-before-write enforced; a wrong parse never books silently.
- `tsc --noEmit` clean; full unit suite green (94/94).

Decision: ADR-005 (hybrid finance storage).
