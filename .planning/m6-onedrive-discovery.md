# M6 — OneDrive discovery (live, 2026-06-29)

> Pulled directly from the **live deployed agent** (driven in-browser as Wency against
> https://aquavoy.vercel.app, read-only `list_folder`/`search_files`/`read_file`). This
> resolves the `[NEEDS CLIENT INPUT]` gates on M6 Phases 3 + 4 — the templates and the
> voyage register are already in the connected OneDrive; no July-meeting delivery needed.
> Names are Dutch.

## Invoice templates — Phase 3 (ADR-007)

**Path:** `/Documenten/ttt/Bureaublad/alle firma's/Aquavoy Ltd/Verzonden Facturen/{year}` (e.g. `…/2026`).

**Format (DECISIVE):** every invoice exists as BOTH **`.docx` (Word)** and `.pdf`. The `.docx` are
fillable → **docxtemplater (ADR-007) is confirmed viable**; we fill a copy of an existing `.docx`,
not reconstruct a PDF.

**Filename convention** (company encoded in the name):
- Gefo voyages: `26-001 Invoice Aquavoy - Gefo 06-01-2026 voyage 01.docx`
- Layovers: `26-002 Invoice Aquavoy - Gefo 16-01-2026 Layover time voyage 63.docx`
- Novo Porto: `26-027 Aquavoy Ltd - Novo Porto Scheepvaart BV 27-03-2026.docx`

**Numbering:** sequential `YY-NNN` for sales/services invoices (26-001 … 26-056 in 2026).

**Gefo self-billing / freight statements (Gutschrift = credit note):** `2640xxxx` series —
13 in the `Gefo verwerkt` ("Gefo processed") subfolder, ~19 in the `Verzonden Facturen` root.
So the two formats Wency meant by "GEFO vs other companies" are: (a) **Gefo** self-billing
statements, and (b) the **Aquavoy Ltd → Novo Porto Scheepvaart BV** sales invoice.

**Invoice template structure** (read from `26-047 … Novo Porto Scheepvaart BV 27-05-2026.pdf`):
- **Issuer (top-left):** Aquavoy Ltd, Ledras 147, 1st floor office 6, 1011 Nicosia Cyprus — VAT CY 60038875Q
- **Recipient:** e.g. Novo Porto Scheepvaart BV, Wilhelminaplein 1, 2074 DE Rotterdam — VAT NL819154064B01
- **Metadata:** Invoice Date `DD-MM-YYYY`, Invoice number `YY-NNN`
- **Message line:** "Hereby we charge you for services rendered onboard of the Mts Pride of Faial,"
- **Line items:** Crewing Services; Travel Cost; Service Fee (Food and Drink); Cash advance (deducted, shown as `…-`); **VAT Shifted**; Total
- **Footer:** payment term 7 days; Revolut Bank `LT62 3250 0781 7194 2284` BIC Revolut21; contact Admin@aquavoy.com

→ docxtemplater placeholders to map: `{recipient_name}`, `{recipient_address}`, `{recipient_vat}`,
`{invoice_date}`, `{invoice_number}`, `{vessel}`, line-item amounts (`{crewing}`, `{travel}`,
`{service_fee}`, `{cash_advance}`, `{total}`). The mapping is confirmed once we read an actual
`.docx` (next step in P3 build) to see how Wency tokenises it.

## Voyage register — Phase 4 (ADR-006)

**File:** `Reis registratie.xlsx` ("voyage registration")
**Path:** `/Documenten/ttt/Bureaublad/Reis registratie.xlsx` (one sheet per year — 2024 / 2025 / 2026)

**Column headers (sheet "2024"), with translation → `voyage_entries` field:**

| Dutch column | Meaning | voyage_entries field |
|---|---|---|
| REIS | voyage no. | `voyage_no` |
| BEVRACHTER | charterer | `charterer` |
| VAN | from port | `port_from` |
| NAAR | to port | `port_to` |
| BEGIN/LAAD | start / load date | `load_date` |
| EIND/LOS | end / discharge date | `discharge_date` |
| LADING | cargo | `cargo_type` |
| TONNAGE | tonnage | `tonnage` |
| P/TON | price per ton | `price_per_ton` |
| KWZ | (charge code — confirm) | `kwz` |
| TOTAAL | total | `total` |
| OPBRENGST | revenue/earnings | `revenue` |
| PROVISIE -5% | handler provision (−5%) | `handler_provision` |
| LIGGELD | demurrage / waiting-time fee | `demurrage` |
| GASOLIE | diesel/fuel | `fuel` |
| PRIJS | price | `fuel_price` (confirm) |
| OLIE KOSTEN | oil cost | `oil_cost` |
| HAVENGELD LAAD | port dues (loading) | `port_dues_load` |
| HAVENGELD LOS | port dues (discharge) | `port_dues_discharge` |
| NETTO | net | `net` |
| DAGEN | days (waiting days) | `waiting_days` |
| NETTO P/D | net per day | `net_per_day` |
| GMP | (margin metric — confirm) | `gmp` |
| MATERIAAL GEREINIGD | tank/material cleaned | `material_cleaned` |
| ZHC | (cleaning charge code — confirm) | `zhc` |
| OPMERKING REIS | voyage remark | `note` |

This is the authoritative schema for the `voyage_entries` migration (ADR-006) — the placeholder
schema in ADR-006 is now superseded by these real columns. Three codes (KWZ, GMP, ZHC) are
shipping-jargon abbreviations to confirm with Wency, but they don't block the table (store as-is).

## Source mailboxes (for Phase 5 inbox-scan + the extraction/bundling flow)

From the meeting (transcript L371, summary L48) — the data arrives by email, fixed addresses:
- **Credit notes (Gefo *Gutschrift*) → `admin@aquavoy.com`** (also the invoice footer contact `Admin@aquavoy.com`).
- **Voyage details / measurements → `rice@aquavoy.com`** ("Rice at AquaVoy" — auto-transcribed; confirm exact spelling with Wency).

The agent must **bundle** a credit note (admin@) + its matching voyage-details email (rice@) into ONE voyage row + invoice. This is the Phase-5 inbox-scan's target mailbox set, and the bundling key (voyage number, e.g. the Gefo reference) is what links the two messages.

## What this changes
- **P3 + P4 client-input gates → RESOLVED.** Buildable now; the July meeting becomes a *review/UAT*
  session, not a requirements-gathering blocker.
- The one thing still worth doing in P3 build: read an actual `.docx` invoice to capture Wency's
  exact placeholder tokens (so docxtemplater fills the right fields). That's a build step, not a gate.
</content>
