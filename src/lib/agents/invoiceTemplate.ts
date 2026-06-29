import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * All token fields used in the Aquavoy invoice `.docx` templates.
 * Matches the token set documented in `assets/invoice-templates/README.md`.
 * Every field is a string — amounts are pre-formatted by the caller.
 */
export interface InvoiceFields {
  recipient_name: string;
  recipient_address: string;
  recipient_vat: string;
  invoice_date: string;
  invoice_number: string;
  vessel: string;
  crewing: string;
  travel: string;
  service_fee: string;
  cash_advance: string;
  total: string;
  currency: string;
}

/**
 * Fill a `.docx` invoice template buffer with the given fields and return the
 * filled document as a Buffer.
 *
 * Pure function — no IO. The caller owns reading the template and writing the
 * output (ADR-007 §1 "adapters-at-seams: keep fill as a pure lib, no IO").
 *
 * @param templateBuffer - Raw bytes of the `.docx` template file.
 * @param data           - Field values matching the template's `{token}` set.
 * @returns              - Buffer containing the filled `.docx`.
 * @throws               - A single readable Error if the template contains
 *                         malformed tags, naming every offending tag in the
 *                         message instead of surfacing docxtemplater's raw
 *                         multi-error object.
 */
export function fillInvoiceTemplate(
  templateBuffer: Buffer,
  data: InvoiceFields,
): Buffer {
  /** Normalize a docxtemplater multi-error into a single readable Error. */
  function wrapDocxError(err: unknown): never {
    const cast = err as {
      properties?: {
        errors?: Array<{ message?: string; properties?: { xtag?: string } }>;
      };
    };
    const inner = cast?.properties?.errors;
    if (inner && inner.length > 0) {
      const parts = inner.map((e) => {
        const tag = e.properties?.xtag ? `"${e.properties.xtag}"` : "";
        const msg = e.message ?? "template error";
        return tag ? `${msg} (tag: ${tag})` : msg;
      });
      throw new Error(`Invoice template error: ${parts.join("; ")}`);
    }
    throw err;
  }

  const zip = new PizZip(templateBuffer);

  let doc: Docxtemplater;
  try {
    // The constructor compiles the template; malformed tags throw here.
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "",
    });
  } catch (err) {
    wrapDocxError(err);
  }

  try {
    doc.render(data);
  } catch (err) {
    wrapDocxError(err);
  }

  return doc.toBuffer();
}
