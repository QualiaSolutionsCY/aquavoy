-- Finance entries: the Supabase finance INDEX/LEDGER (ADR-005). The actual
-- invoice/receipt FILES stay in OneDrive, organized per company by the finance
-- "scan & propose" feature; this table holds the structured NUMBERS that power
-- the per-entity ledger and the consolidated expense/income views — folders of
-- PDFs cannot be aggregated, an index can. Each row records one expense/income
-- line for one of the eight group companies (see src/app/finance/page.tsx
-- COMPANIES) and may reference back to its OneDrive item via source_ref.
-- Like 0013/0014 this table is locked to the service role — RLS is enabled with
-- NO policies, so the anon/authenticated keys can read nothing. Only server code
-- using SUPABASE_SERVICE_ROLE_KEY touches it (via src/lib/finance/ledger.ts).
-- Writes are CONFIRM-BEFORE-WRITE (ADR-005): the agent stages a pending_actions
-- row, the human confirms, and only then is a row inserted here — so a wrong
-- invoice parse never silently corrupts the books.
--   * direction — 'expense' or 'income'.
--   * amount    — positive magnitude in `currency`; net is income - expense.
--   * currency  — defaults to 'EUR' (single-currency for v1).
--   * status    — 'confirmed' once written (every persisted row is confirmed).

create table if not exists public.finance_entries (
  id           uuid primary key default gen_random_uuid(),
  company      text not null,
  direction    text not null,
  amount       numeric(14,2) not null,
  currency     text not null default 'EUR',
  doc_date     date,
  description  text,
  source_ref   text,
  source_name  text,
  created_by   text,
  status       text not null default 'confirmed',
  created_at   timestamptz not null default now(),
  constraint finance_entries_direction_check check (direction in ('expense','income'))
);

comment on table public.finance_entries is
  'Finance index/ledger (ADR-005): per-company expense/income lines powering the consolidated + per-entity views. Files stay in OneDrive; this holds the numbers. Service-role only (RLS on, no policies).';

-- Supports financeSummary, which aggregates entries grouped by company.
create index if not exists finance_entries_company_idx
  on public.finance_entries (company);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.finance_entries enable row level security;
