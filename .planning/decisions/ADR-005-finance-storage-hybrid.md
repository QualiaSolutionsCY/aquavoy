# ADR-005 — Finance Storage: Hybrid (OneDrive document store + Supabase finance index)

**Date:** 2026-06-18
**Milestone:** M5 — Client Meeting Build
**Status:** Accepted
**Deciders:** Moayad (EMPLOYEE) — engineering decision; client deferred ("either way, be flexible"). OWNER ratification on first finance-views ship.
**Domain terms:** group companies (the 8 legal entities), finance index, per-entity ledger, consolidated view
**Touches:** `src/app/finance/*`, `src/lib/agents/onedriveTools.ts`, future `supabase/migrations/*` (finance index tables), `src/lib/microsoft/onedrive.ts`

## Context

In the 2026-06-18 client meeting, Wency described two finance needs that pull in different
directions on storage:

1. **Keep documents in OneDrive, exportable.** "It can be either of those ways… but we need
   to be able to export out of the agent" (transcript 28:37); "organize the OneDrive that we
   already have" → later "actually better to create a separate database" (29:31). He keeps
   per-company folders in his own OneDrive and wants files to stay there and remain
   exportable (e.g. Excel ship-movement files).
2. **Consolidated + per-company expense/income views.** "the whole view of our companies all
   together… but we can check them also individually" (42:00), classified by legal entity.

Neither Wency nor the team locked a storage model; the reply was "we'll be flexible" (29:47).
This is an architecture call, not a client decision.

**What already exists in code:**
- The 8 group companies are implemented (`src/app/finance/page.tsx` `COMPANIES`, glossary in
  `.planning/CONTEXT.md`).
- Filing-by-company already works: the Finance tab's "scan & propose organization" instructs
  the agent to file each company's documents under its own OneDrive folder (`companyClause()`),
  as a propose-then-confirm flow over the connected OneDrive.
- What is NOT built: real **expense/income numbers** — extraction, aggregation, per-entity
  ledger, consolidated totals (finance audit N1/N2 PARTIAL, N3 NOT BUILT).

## Decision

**Do not choose between "organize OneDrive" and "separate database" — do both, with clear
ownership per concern.**

1. **OneDrive remains the document store (system of record for files).** The actual invoice/
   receipt PDFs live in Wency's OneDrive, organized per-company/per-year by the agent, and stay
   fully exportable. Files are never moved out of his OneDrive or locked into the app.
2. **Supabase holds a finance INDEX/LEDGER (system of record for numbers).** A structured table
   records, per document: company, amount, currency, date, type (expense/income), and a
   reference back to the OneDrive file. This — not folders — powers the per-entity ledger and
   the consolidated view.
3. **The index references, never replaces, the document.** Every ledger row points at its
   OneDrive item; deleting/relocating the file is reconciled against the index, not duplicated.
4. **Classification reuses the existing company list** (`COMPANIES`) and Wency's existing
   folder structure (readable via the connected OneDrive); no new company master is invented.

## Alternatives considered

- **Organize OneDrive only (no DB).** Rejected — consolidated/per-company totals ("2026
  expenses across all companies") are impossible from folders of PDFs; there is nothing to
  aggregate. Satisfies filing, fails the views Wency explicitly asked for.
- **Separate agent-managed database only (pull files out of OneDrive).** Rejected — violates
  Wency's "keep it in OneDrive / must be exportable" requirement and duplicates a document
  store he already maintains and trusts.

## Consequences

- **Easier:** filing already works and stays; the finance-views build is now a contained
  data-layer task (extract → index → render) with no client dependency — company list and
  folders already exist, invoices reachable via the connected account.
- **Harder:** reliable amount/date/type extraction from heterogeneous invoice PDFs is the real
  risk in the views build (LLM-assisted extraction, human-confirmable). The index must be kept
  in sync when the agent moves/renames/deletes underlying files.
- **Load-bearing:** the per-entity + consolidated finance feature depends on this index. If a
  future change tries to derive totals from folders alone, the views break.

## Notes

Resolves the DB-vs-OneDrive question raised at the 2026-06-18 meeting. The "agent name" item
from the same meeting is parked at Wency's request (revisit before the voice agent). Grounded
in the meeting transcript and the finance code audit (`finance/page.tsx`, onedrive tooling).
