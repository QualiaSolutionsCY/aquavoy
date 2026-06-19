import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Finance INDEX/LEDGER (ADR-005). The invoice/receipt FILES stay in OneDrive,
 * organized per company by the finance "scan & propose" feature; this module
 * owns the structured NUMBERS that power the consolidated + per-entity views.
 * Rows live in `public.finance_entries` (see 0015_finance_entries.sql). All
 * access goes through the service-role client — the table has RLS enabled with
 * NO public policies, so only server code touches it.
 *
 * Writes are CONFIRM-BEFORE-WRITE: `recordFinanceEntry` is only reached from the
 * confirm endpoint (executeConfirmedAction → record_finance_entry), after a human
 * has approved the staged action — a wrong invoice parse never silently corrupts
 * the books.
 */

const TABLE = "finance_entries";

/**
 * The eight legal entities the group's accounting revolves around. This mirrors
 * `COMPANIES` in src/app/finance/page.tsx (the source of truth) — it is NOT
 * exported from that "use client" route module, so the canonical list is
 * re-declared here for this server-side lib. Keep the two in lock-step.
 */
export const FINANCE_COMPANIES = [
  "Aquavoy Holding",
  "Aquavoy Shipping",
  "Aquavoy Crewing",
  "W&D Holding",
  "W&D Trading",
  "Denver Services BV",
  "Faial BV",
  "Novo Porto Scheepvaart BV",
] as const;

/** Single-currency assumption for v1 — every entry is treated as EUR. */
const DEFAULT_CURRENCY = "EUR";

export type FinanceDirection = "expense" | "income";

export interface FinanceCompanyTotals {
  company: string;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface FinanceSummary {
  currency: string;
  companies: FinanceCompanyTotals[];
  consolidated: { income: number; expense: number; net: number; count: number };
}

/** A persisted finance entry, as it comes back from the DB. */
interface FinanceEntryRow {
  company: string;
  direction: string;
  amount: number | string;
}

/** Round to 2 decimal places, guarding against float drift in the roll-up. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Summary ──────────────────────────────────────────────────

/**
 * Aggregate all finance entries into per-company income/expense/net plus a
 * consolidated roll-up. ALWAYS returns all eight group companies, in the
 * canonical order, filling zeros where a company has no entries — so the views
 * never hide an entity just because it has not been booked against yet.
 *
 * Unknown companies (a row whose `company` is not one of the eight) still count
 * toward the consolidated roll-up but are not surfaced as their own card; the
 * eight-company list is fixed.
 */
export async function financeSummary(): Promise<FinanceSummary> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("company, direction, amount")
    .eq("status", "confirmed");

  if (error) throw new Error(`Failed to load finance entries: ${error.message}`);

  // Seed every group company at zero so all eight always appear.
  const totals = new Map<string, FinanceCompanyTotals>();
  for (const company of FINANCE_COMPANIES) {
    totals.set(company, { company, income: 0, expense: 0, net: 0, count: 0 });
  }

  const consolidated = { income: 0, expense: 0, net: 0, count: 0 };

  for (const row of (data ?? []) as FinanceEntryRow[]) {
    const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
    if (!Number.isFinite(amount)) continue;

    // Consolidated counts every confirmed row, including any not in the fixed
    // eight (e.g. legacy/renamed entities) — the group view must be complete.
    consolidated.count += 1;
    if (row.direction === "income") consolidated.income += amount;
    else if (row.direction === "expense") consolidated.expense += amount;

    const bucket = totals.get(row.company);
    if (!bucket) continue; // not one of the eight — rolls up but has no card.
    bucket.count += 1;
    if (row.direction === "income") bucket.income += amount;
    else if (row.direction === "expense") bucket.expense += amount;
  }

  const companies = FINANCE_COMPANIES.map((company) => {
    const t = totals.get(company)!;
    const income = round2(t.income);
    const expense = round2(t.expense);
    return { company, income, expense, net: round2(income - expense), count: t.count };
  });

  const income = round2(consolidated.income);
  const expense = round2(consolidated.expense);

  return {
    currency: DEFAULT_CURRENCY,
    companies,
    consolidated: { income, expense, net: round2(income - expense), count: consolidated.count },
  };
}

// ── Record ───────────────────────────────────────────────────

export interface RecordEntryInput {
  company: string;
  direction: FinanceDirection;
  amount: number;
  currency?: string;
  docDate?: string | null;
  description?: string | null;
  sourceRef?: string | null;
  sourceName?: string | null;
  createdBy?: string | null;
}

/**
 * Insert one confirmed finance entry. Called only from the confirm path
 * (executeConfirmedAction) after a human has approved the staged action.
 * Validates direction, a finite positive amount, and a non-empty company so a
 * malformed parse cannot reach the ledger.
 */
export async function recordFinanceEntry(input: RecordEntryInput): Promise<{ id: string }> {
  const company = input.company?.trim();
  if (!company) throw new Error("company is required");
  if (input.direction !== "expense" && input.direction !== "income") {
    throw new Error('direction must be "expense" or "income"');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a finite number greater than 0");
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      company,
      direction: input.direction,
      amount: round2(input.amount),
      currency: input.currency?.trim() || DEFAULT_CURRENCY,
      doc_date: input.docDate ?? null,
      description: input.description ?? null,
      source_ref: input.sourceRef ?? null,
      source_name: input.sourceName ?? null,
      created_by: input.createdBy ?? null,
      status: "confirmed",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to record finance entry: ${error.message}`);
  return { id: (data as { id: string }).id };
}

// ── Delete (undo) ────────────────────────────────────────────

/**
 * Delete a finance entry by id — the reversal for a confirmed record action.
 * Hard delete: the entry never should have been booked, so it leaves no trace
 * in the ledger (the undo path, not a void/credit note).
 */
export async function deleteFinanceEntry(id: string): Promise<void> {
  if (!id) throw new Error("id is required");
  const db = supabaseAdmin();
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`Failed to delete finance entry: ${error.message}`);
}
