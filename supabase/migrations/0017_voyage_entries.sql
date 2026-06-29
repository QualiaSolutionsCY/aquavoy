-- Voyage entries: the Supabase voyage economics INDEX (ADR-006 / REQ-28). The
-- actual voyage register FILE stays in OneDrive (Reis registratie.xlsx, one
-- sheet per year); this table holds the structured NUMBERS that power the
-- per-company voyage drill-down on the finance page — an Excel file cannot be
-- aggregated, an index can. Each row records one voyage for one of the eight
-- group companies (see src/app/finance/page.tsx COMPANIES) and maps to the 26
-- real Dutch columns from the live register (confirmed 2026-06-29, documented
-- in .planning/m6-onedrive-discovery.md:49-76). Like 0015 this table is locked
-- to the service role — RLS is enabled with NO policies, so the
-- anon/authenticated keys can read nothing. Only server code using
-- SUPABASE_SERVICE_ROLE_KEY touches it (via src/lib/finance/voyageLedger.ts).
-- Writes are CONFIRM-BEFORE-WRITE (ADR-006): the agent stages a pending_actions
-- row, the human confirms, and only then is a row inserted here — so a wrong
-- register parse never silently corrupts the voyage economics.
--   All 26 voyage columns are nullable (Wency's register often has partial rows
--   mid-voyage); only `company` is required, constrained to the 8 legal entities.

create table if not exists public.voyage_entries (
  id                    uuid primary key default gen_random_uuid(),
  company               text not null,
  -- Register columns (Dutch → field, in register order per m6-onedrive-discovery.md:49-76)
  voyage_no             text,                   -- REIS
  charterer             text,                   -- BEVRACHTER
  port_from             text,                   -- VAN
  port_to               text,                   -- NAAR
  load_date             text,                   -- BEGIN/LAAD (free-form text, Wency's dates are not ISO)
  discharge_date        text,                   -- EIND/LOS
  cargo_type            text,                   -- LADING
  tonnage               numeric(14,3),          -- TONNAGE
  price_per_ton         numeric(14,2),          -- P/TON
  kwz                   text,                   -- KWZ (charge code jargon)
  total                 numeric(14,2),          -- TOTAAL
  revenue               numeric(14,2),          -- OPBRENGST
  handler_provision     numeric(14,2),          -- PROVISIE -5%
  demurrage             numeric(14,2),          -- LIGGELD
  fuel                  numeric(14,2),          -- GASOLIE
  fuel_price            numeric(14,2),          -- PRIJS
  oil_cost              numeric(14,2),          -- OLIE KOSTEN
  port_dues_load        numeric(14,2),          -- HAVENGELD LAAD
  port_dues_discharge   numeric(14,2),          -- HAVENGELD LOS
  net                   numeric(14,2),          -- NETTO
  waiting_days          numeric(10,2),          -- DAGEN
  net_per_day           numeric(14,2),          -- NETTO P/D
  gmp                   text,                   -- GMP (margin metric jargon)
  material_cleaned      text,                   -- MATERIAAL GEREINIGD
  zhc                   text,                   -- ZHC (cleaning charge code jargon)
  note                  text,                   -- OPMERKING REIS
  -- Metadata
  source_ref            text,
  created_by            text,
  status                text not null default 'confirmed',
  created_at            timestamptz not null default now(),
  constraint voyage_entries_company_check check (company in (
    'Aquavoy Holding',
    'Aquavoy Shipping',
    'Aquavoy Crewing',
    'W&D Holding',
    'W&D Trading',
    'Denver Services BV',
    'Faial BV',
    'Novo Porto Scheepvaart BV'
  ))
);

comment on table public.voyage_entries is
  'Voyage economics index (ADR-006 / REQ-28): per-company voyage rows powering the consolidated + per-entity voyage drill-down. Register file stays in OneDrive (Reis registratie.xlsx); this holds the structured numbers. Service-role only (RLS on, no policies).';

-- Supports voyageSummary, which aggregates entries grouped by company.
create index if not exists voyage_entries_company_idx
  on public.voyage_entries (company);

-- RLS on, no policies → table is inaccessible to anon/authenticated roles.
alter table public.voyage_entries enable row level security;
