# Aquavoy — Finance Build: Client Input Status (2026-06-18)

**Bottom line: nothing is blocking us. We already have what we need to build.**

## Already in hand — no need to ask Wency
- **Company list** — the 8 legal entities are implemented in code
  (`src/app/finance/page.tsx` `COMPANIES`, mirrored in `.planning/CONTEXT.md`):
  Aquavoy Holding, Aquavoy Shipping, Aquavoy Crewing, W&D Holding, W&D Trading,
  Denver Services BV, Faial BV, Novo Porto Scheepvaart BV.
- **Per-company folders** — Wency already keeps these in his OneDrive, and his OneDrive
  is connected, so the agent can read the structure directly.
- **Real invoices** — his email + OneDrive are connected; the agent reads actual
  invoices/receipts from there, so no need for him to send samples.
- **Filing-by-company already exists** — the Finance tab's "scan & propose organization"
  already instructs the agent to file each company's documents under its own folder
  (`companyClause()` in `finance/page.tsx`). This *is* the "organize invoices by company"
  ask — built as a propose-and-confirm flow over his existing OneDrive folders.

## What's actually left to build — still no client input needed
The finance **views** Wency asked for — a real **consolidated + per-company
expense/income overview** — are not built yet. The Finance tab today organizes files but
shows no real numbers. Remaining work: extract amount / date / type from each invoice →
index it per company in Supabase → render per-entity and consolidated totals. Files stay
in his OneDrive; the index sits on top (hybrid — see internal note).

## Optional (nice, not blocking)
Confirm his OneDrive folder names match the 8 company names so the agent files into the
existing folders rather than creating new ones — though the agent can also just list his
folders and map automatically.

---

### Internal note
- **Agent name:** parked at Wency's request — revisit before the voice agent.
- **DB-vs-OneDrive:** resolved as an engineering decision — **hybrid**. OneDrive stays the
  document store (filing-by-company already built); Supabase holds the finance
  index/ledger that powers the expense/income views. Rationale: consolidated/per-company
  finance is impossible from folders alone, and Wency requires files stay in OneDrive +
  exportable. Pending: lock as **ADR-005**.
