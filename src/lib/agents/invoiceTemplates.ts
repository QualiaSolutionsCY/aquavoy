import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Per-company invoice template registry (ADR-007 §4). Rows live in
 * `public.invoice_templates` (see 0016_invoice_templates.sql). All access goes
 * through the service-role client — the table has RLS enabled with no public
 * policies. `template_ref` is the committed asset path; `output_folder_path`
 * is the OneDrive destination (year appended at runtime by the caller).
 */

const TABLE = "invoice_templates";

export interface InvoiceTemplateRow {
  id: string;
  company: string;
  template_ref: string;
  output_folder_path: string;
  field_mapping_json: Record<string, string> | null;
  created_at: string;
}

/**
 * Fetch the invoice template row for the given company. Throws a readable
 * error if no row is found (e.g. the migration has not been applied yet).
 */
export async function getInvoiceTemplate(
  company: "Gefo" | "Novo Porto",
): Promise<InvoiceTemplateRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id, company, template_ref, output_folder_path, field_mapping_json, created_at")
    .eq("company", company)
    .maybeSingle();

  if (error) throw new Error(`Failed to load invoice template for ${company}: ${error.message}`);
  if (!data) throw new Error(`no invoice template for company: ${company}`);
  return data as InvoiceTemplateRow;
}
