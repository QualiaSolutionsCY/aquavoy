import { z } from "zod";
import { complete, type ChatMessage } from "@/lib/openrouter/client";

/**
 * Zod schema for an LLM-extracted invoice.
 *
 * Amount fields (`crewing`, `travel`, `service_fee`, `cash_advance`, `total`)
 * accept both a plain number and a string from the model, coercing both to a
 * formatted "X.XX" string.  Missing optional amounts default to "0.00".
 * `company` is restricted to the two companies Aquavoy issues invoices for.
 *
 * This schema is the type contract for the confirm card — a wrong amount must
 * be a typed field the UI can show and the user can correct before the template
 * is filled (ADR-007 §3).
 */

/** Coerce number | string → "X.XX" string. */
const moneyString = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (isNaN(n)) return "0.00";
    return n.toFixed(2);
  });

export const ExtractedInvoiceSchema = z.object({
  company: z.enum(["Gefo", "Novo Porto"]),
  recipient_name: z.string(),
  recipient_address: z.string(),
  recipient_vat: z.string(),
  vessel: z.string(),
  invoice_date: z.string(),
  invoice_number: z.string(),
  crewing: moneyString.default("0.00"),
  travel: moneyString.default("0.00"),
  service_fee: moneyString.default("0.00"),
  cash_advance: moneyString.default("0.00"),
  total: moneyString,
  currency: z.string().default("EUR"),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

/**
 * Extract invoice fields from the text of a source credit-note / voyage PDF.
 *
 * Pure function — no IO beyond the OpenRouter call (ADR-007 §3 "adapters-at-seams").
 * The caller owns reading the PDF text (`read_file` via `unpdf`) and passing it here.
 *
 * @param pdfText - Plain text extracted from the source PDF.
 * @returns       - Validated `ExtractedInvoice` ready for the confirm card.
 * @throws        - `Error("invoice extraction failed validation: ...")` when the
 *                  model's JSON doesn't match the schema, naming each invalid field.
 */
export async function extractInvoiceFields(pdfText: string): Promise<ExtractedInvoice> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "You are a precise invoice data extractor for Aquavoy Ltd, a shipping company.",
        "Extract the following fields from the provided credit note or invoice document text.",
        "Return ONLY a valid JSON object with exactly these keys, no markdown, no code fences:",
        "  company         — one of: \"Gefo\" or \"Novo Porto\" (the issuing company for the invoice)",
        "  recipient_name  — the recipient company name",
        "  recipient_address — full address of the recipient",
        "  recipient_vat   — recipient VAT number",
        "  vessel          — vessel name (look for 'Mts' prefix or ship/vessel name)",
        "  invoice_date    — date in DD-MM-YYYY format",
        "  invoice_number  — invoice/credit-note number (e.g. '26-047')",
        "  crewing         — crewing services amount as a number (e.g. 4500.00), or 0 if absent",
        "  travel          — travel cost amount as a number, or 0 if absent",
        "  service_fee     — service fee (food and drink) amount as a number, or 0 if absent",
        "  cash_advance    — cash advance deducted amount as a number, or 0 if absent",
        "  total           — total invoice amount as a number",
        "  currency        — currency code, default \"EUR\"",
        "If a field cannot be determined, use an empty string for text fields and 0 for amounts.",
        "Output only the raw JSON — no prose, no explanation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Extract invoice fields from this document:\n\n${pdfText}`,
    },
  ];

  const raw = await complete(messages);

  // Strip code fences that some models wrap around JSON output.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      `invoice extraction failed: model did not return valid JSON. Raw output: ${raw.slice(0, 200)}`,
    );
  }

  try {
    return ExtractedInvoiceSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`invoice extraction failed validation: ${issues}`);
    }
    throw err;
  }
}
