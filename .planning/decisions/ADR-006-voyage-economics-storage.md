# ADR-006 — Voyage Economics Storage: parallel `voyage_entries` table (not columns on `finance_entries`)

**Date:** 2026-06-28
**Milestone:** M6 — Invoice Automation (Phase 4)
**Status:** Proposed (ratify when Phase 4 opens, after the July office meeting confirms the register schema)
**Deciders:** Moayad (EMPLOYEE) — engineering decision. Client supplies the register schema + company mappings; OWNER ratification on first voyage-views ship.
**Domain terms:** voyage entry, voyage economics, handler provision, waiting time, oil surcharge, group companies (the 8 legal entities)
**Touches:** `supabase/migrations/*` (new `voyage_entries` table), `src/lib/finance/voyageLedger.ts` (new), `src/lib/finance/ledger.ts`, `src/app/finance/page.tsx`, `src/lib/agents/onedriveTools.ts`, `src/lib/agents/executeConfirmedAction.ts`
**Extends:** ADR-005 (finance storage hybrid)

## Context

The 2026-06-25 meeting clarified that Wency keeps a **specialized Excel register** the generic finance ledger cannot represent. Per voyage he records: route (from→to ports), departure/arrival dates, cargo type, tonnage, price per ton, **handler provisions** (paid separately), **waiting time** (days billed separately at a day-rate), and **oil/fuel surcharge** — primarily for **Aquavoy Shipping** and **Novo Porto Scheepvaart BV**. He asked to "integrate this into the finance page" (transcript 27:08–28:59).

The current finance ledger (`src/lib/finance/ledger.ts:39–166`, migration `0015_finance_entries`) records only `company / direction / amount / currency / date / description` per ADR-005. It has no field for any voyage attribute. The non-shipping group companies (W&D Holding, Denver Services BV, etc.) never have voyages.

## Decision

**Store voyage economics in a parallel, RLS-gated `voyage_entries` table — not as nullable columns on `finance_entries`.** A voyage entry may reference one or more `finance_entries` rows (the booked income/expense lines) via a foreign key / reference column, but the voyage-specific attributes live in their own table.

1. `voyage_entries` carries: `company` (CHECK against the 8 entities), `port_from`, `port_to`, `departure_date`, `arrival_date`, `cargo_type`, `tonnage`, `price_per_unit`, `currency`, `handler_provisions`, `waiting_time_days`, `waiting_time_rate`, `oil_surcharge`, `vessel_name`, `source_ref` (OneDrive item id, for bundling), `created_by`, `status`, `created_at`. **Exact columns + mandatory-vs-optional are finalized against Wency's sample register file** (collected July 3) — the shape above is the working draft, not the locked schema.
2. RLS on, **service-role only** (no client policies), matching `finance_entries` — the app never reads voyage rows client-side (constitution + ADR-005).
3. Writes go through the existing confirm-before-write staging (ADR-003): `record_voyage_entry` and the Excel-register import stage rows; nothing books until the human confirms.
4. The finance page renders voyage drill-down from a new `voyageLedger.ts` aggregator that mirrors the `financeSummary` pattern in `ledger.ts:79–128`.

## Alternatives considered

- **Nullable `voyage_*` columns on `finance_entries`.** Rejected — bloats every generic expense row with ~10 unused columns, violates 3NF (voyage attributes depend on the voyage, not on the expense/income classification), and makes voyage aggregation a `WHERE voyage_route IS NOT NULL` scan. Simpler migration, worse model.
- **A `JSONB voyage_meta` column on `finance_entries`.** Rejected — flexible for exploration but loses per-field indexing and constraint enforcement; "revenue per ton on route X" becomes a JSON scan with no type safety.

## Consequences

- **Easier:** voyage-specific queries (per-ton margin, per-route revenue) stay efficient and indexed (`(company, departure_date)`); non-shipping companies carry zero voyage overhead; the generic ledger stays exactly as ADR-005 shipped it.
- **Harder:** two tables to keep consistent when a voyage's booked lines change; the import parser must map Wency's (still-unknown) column layout onto this schema; multi-email bundling (credit note → admin@, voyage detail → rice@) is a **user-driven merge in the UI**, not silent LLM inference (see scope-m6 Phase 4 risk).
- **Load-bearing:** the voyage drill-down depends on this table. The final column list is a `[NEEDS CLIENT INPUT]` item until the July meeting — do not lock the migration before the sample file lands.
