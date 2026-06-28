# ADR-007 — Invoice Generation: fill Wency's template with `docxtemplater`, LLM-extract fields, store templates in OneDrive + Supabase metadata

**Date:** 2026-06-28
**Milestone:** M6 — Invoice Automation (Phase 3)
**Status:** Proposed (ratify when Phase 3 opens, after the July office meeting delivers the actual templates)
**Deciders:** Moayad (EMPLOYEE) — engineering decision. Client supplies the template files + field mapping + company→template assignment; OWNER ratification on first generated invoice.
**Domain terms:** invoice template, credit note, field mapping, company→template assignment, GEFO
**Touches:** `src/lib/agents/invoiceTemplate.ts` (new), `src/lib/agents/invoiceExtraction.ts` (new), `src/lib/agents/onedriveTools.ts`, `src/lib/agents/executeConfirmedAction.ts`, `supabase/migrations/*` (`invoice_templates`), `scripts/load-invoice-templates.ts` (new)
**Extends:** ADR-003 (enforced confirm/undo), ADR-005 (OneDrive document store + Supabase index)
**Depends on:** REQ-26 (attachment→OneDrive) for the source-PDF path

## Context

The 2026-06-25 meeting made invoice generation the **#1 ask** — Wency: "I need to see, for the credit notes, how you're gonna make invoices for me… he needs to use the invoice template that I already used" and "he needs to know the differences between GEFO and other companies" (transcript 13:00–15:57). Today there is **no** invoice generation: `create_spreadsheet` (`onedriveTools.ts:148`) builds only a generic blank `.xlsx`; there is no template handling and no company-format distinction. He builds an invoice manually "in less than 30 seconds," so the agent must be both correct and faster — and trusted only after a confirmation period (he asked for confirm-before-finalize until he trusts it).

`read_file` already extracts PDF text via `unpdf` (`onedriveTools.ts:856–870`); `mammoth` is already a dependency (reads `.docx` to text).

## Decision

**Generate invoices by filling Wency's real template with `docxtemplater` (+ `pizzip`), extracting fields LLM-assisted from the source PDF text, with templates stored in OneDrive and selected per company via a Supabase `invoice_templates` table.**

1. **Templating engine: `docxtemplater` + `pizzip` on `.docx` templates** (primary). Wency maintains templates in Word with `{{placeholder}}` syntax; `docxtemplater` does the mail-merge fill, including image placeholders (logos). `xlsx-template` is the fallback only if a given company's invoice is genuinely Excel-native.
2. **No PDF *generation* in the MVP.** Reading PDFs (source credit notes) stays on `unpdf`; producing the output stays in Word/Excel, which is Wency's actual workflow. PDF assembly libraries (PDFKit/pdfmake) are deferred — only revisit if he requires PDF output.
3. **Field extraction: LLM-assisted from `unpdf` text**, validated against a schema (`voyage_id`, `shipper`, `receiver`, `amount`, `currency`, `date`, `company`), then **shown in the confirmation card for human correction** before the template is filled. Heterogeneous carrier formats make coordinate/OCR matching brittle; the confirm gate (ADR-003) is what makes LLM extraction safe.
4. **Template storage = ADR-005 hybrid:** the template files live in Wency's OneDrive (he edits them in Word, fully exportable); a Supabase `invoice_templates` table holds metadata — `company`, `template_file_id`, `output_format`, `field_mapping_json` — loaded by a CLI script after he provides the files. At invoke time the agent looks up the company → the right template.
5. **`generate_invoice_from_template` is confirm-before-write** (added to the `DESTRUCTIVE` set): it stages the extracted fields + the matched template + the proposed output path; the fill + OneDrive upload run only on confirm; undo deletes the generated file.

## Alternatives considered

- **Raw PDF generation (PDFKit/pdfmake).** Rejected for MVP — heavyweight, and Wency's source of truth is Word/Excel templates he wants to keep editing himself.
- **Rule-based / regex field extraction.** Rejected — fragile across carrier formats; breaks the moment a supplier changes layout.
- **Hardcoded `COMPANY_TO_TEMPLATE` map in code.** Rejected — every new company/format needs a deploy; the dynamic `invoice_templates` table scales without code changes.
- **Embed templates as base64 in code.** Rejected — not exportable, can't be edited in Word, violates ADR-005.

## Consequences

- **Easier:** Wency owns his templates (edits in Word, no redeploy); new company formats are a table row + a file, not code; the extract→confirm→fill flow reuses the proven staging pipeline.
- **Harder:** correctness is load-bearing — a wrong shipper or off-by-one amount must be caught at the confirm card; if he ever provides a **non-editable PDF-only** template the engine can't fill it (would force code-based generation — flag at the meeting); the `invoice_templates` metadata goes stale if he edits a template's *structure* in Word (re-run the loader).
- **Blocked until July 3:** the actual template files, the field→placeholder mapping, the company→template assignment, the output-format preference, and the output folder structure are all `[NEEDS CLIENT INPUT]`. Phase 3 cannot finalize without them — scaffold the engine + tool now, wire to real templates after.
