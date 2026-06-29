import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Voyage economics INDEX/LEDGER (ADR-006 / REQ-28). The actual voyage register
 * FILE stays in OneDrive (Reis registratie.xlsx, per-year sheets); this module
 * owns the structured NUMBERS that power the per-company voyage drill-down on
 * the finance page. Rows live in `public.voyage_entries` (see
 * 0017_voyage_entries.sql). All access goes through the service-role client —
 * the table has RLS enabled with NO public policies, so only server code
 * touches it.
 *
 * Writes are CONFIRM-BEFORE-WRITE: `recordVoyageEntry` is only reached from
 * the confirm endpoint (executeConfirmedAction → record_voyage_entry / import_
 * voyage_register), after a human has approved the staged action — a wrong
 * register parse never silently corrupts the voyage economics.
 */

const TABLE = "voyage_entries";

/**
 * The eight legal entities the group's accounting revolves around. Mirrors
 * FINANCE_COMPANIES in ledger.ts (the source of truth list) — re-declared here
 * for this server-side lib since it cannot import from a "use client" module.
 * Keep these two lists in lock-step.
 */
export const VOYAGE_COMPANIES = [
  "Aquavoy Holding",
  "Aquavoy Shipping",
  "Aquavoy Crewing",
  "W&D Holding",
  "W&D Trading",
  "Denver Services BV",
  "Faial BV",
  "Novo Porto Scheepvaart BV",
] as const;

/** Round to 2 decimal places, guarding against float drift in the roll-up. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Types ─────────────────────────────────────────────────────

/** Input for recording a single voyage entry. All voyage fields are optional
 *  (Wency's register often has partial rows mid-voyage); only company is
 *  required. Numeric fields accept number | null — nulls pass through as-is. */
export interface VoyageEntryInput {
  company: string;
  // 26 register columns in register order (Dutch → field)
  voyage_no?: string | null;          // REIS
  charterer?: string | null;          // BEVRACHTER
  port_from?: string | null;          // VAN
  port_to?: string | null;            // NAAR
  load_date?: string | null;          // BEGIN/LAAD
  discharge_date?: string | null;     // EIND/LOS
  cargo_type?: string | null;         // LADING
  tonnage?: number | null;            // TONNAGE
  price_per_ton?: number | null;      // P/TON
  kwz?: string | null;                // KWZ
  total?: number | null;              // TOTAAL
  revenue?: number | null;            // OPBRENGST
  handler_provision?: number | null;  // PROVISIE -5%
  demurrage?: number | null;          // LIGGELD
  fuel?: number | null;               // GASOLIE
  fuel_price?: number | null;         // PRIJS
  oil_cost?: number | null;           // OLIE KOSTEN
  port_dues_load?: number | null;     // HAVENGELD LAAD
  port_dues_discharge?: number | null;// HAVENGELD LOS
  net?: number | null;                // NETTO
  waiting_days?: number | null;       // DAGEN
  net_per_day?: number | null;        // NETTO P/D
  gmp?: string | null;                // GMP
  material_cleaned?: string | null;   // MATERIAAL GEREINIGD
  zhc?: string | null;                // ZHC
  note?: string | null;               // OPMERKING REIS
  // Metadata
  sourceRef?: string | null;
  createdBy?: string | null;
}

export interface VoyageCompanyTotals {
  company: string;
  voyageCount: number;
  revenue: number;
  net: number;
}

export interface VoyageSummary {
  companies: VoyageCompanyTotals[];
  consolidated: { voyageCount: number; revenue: number; net: number };
}

/** A persisted voyage entry row — the aggregation fields we need. */
interface VoyageEntryRow {
  company: string;
  revenue: number | string | null;
  net: number | string | null;
}

// ── Summary ──────────────────────────────────────────────────

/**
 * Aggregate all confirmed voyage entries into per-company totals (count,
 * revenue, net) plus a consolidated roll-up. ALWAYS returns all eight group
 * companies, seeded at zero, in the canonical order — so the voyage drill-down
 * never hides an entity just because it has no voyages yet.
 *
 * Unknown companies still count toward the consolidated roll-up but are not
 * surfaced as their own card; the eight-company list is fixed.
 */
export async function voyageSummary(): Promise<VoyageSummary> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("company, revenue, net")
    .eq("status", "confirmed");

  if (error) throw new Error(`Failed to load voyage entries: ${error.message}`);

  // Seed every group company at zero so all eight always appear.
  const totals = new Map<string, VoyageCompanyTotals>();
  for (const company of VOYAGE_COMPANIES) {
    totals.set(company, { company, voyageCount: 0, revenue: 0, net: 0 });
  }

  const consolidated = { voyageCount: 0, revenue: 0, net: 0 };

  for (const row of (data ?? []) as VoyageEntryRow[]) {
    const revenue = row.revenue != null ? Number(row.revenue) : 0;
    const net = row.net != null ? Number(row.net) : 0;

    // Consolidated counts every confirmed row, including any not in the fixed
    // eight (e.g. legacy/renamed entities) — the group view must be complete.
    consolidated.voyageCount += 1;
    consolidated.revenue += Number.isFinite(revenue) ? revenue : 0;
    consolidated.net += Number.isFinite(net) ? net : 0;

    const bucket = totals.get(row.company);
    if (!bucket) continue; // not one of the eight — rolls up but has no card.
    bucket.voyageCount += 1;
    bucket.revenue += Number.isFinite(revenue) ? revenue : 0;
    bucket.net += Number.isFinite(net) ? net : 0;
  }

  const companies = VOYAGE_COMPANIES.map((company) => {
    const t = totals.get(company)!;
    return {
      company,
      voyageCount: t.voyageCount,
      revenue: round2(t.revenue),
      net: round2(t.net),
    };
  });

  return {
    companies,
    consolidated: {
      voyageCount: consolidated.voyageCount,
      revenue: round2(consolidated.revenue),
      net: round2(consolidated.net),
    },
  };
}

// ── Record ───────────────────────────────────────────────────

/**
 * Insert one confirmed voyage entry. Called only from the confirm path
 * (executeConfirmedAction) after a human has approved the staged action.
 * Validates a non-empty company so a malformed parse cannot reach the ledger.
 */
export async function recordVoyageEntry(input: VoyageEntryInput): Promise<{ id: string }> {
  const company = input.company?.trim();
  if (!company) throw new Error("company is required");

  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      company,
      voyage_no: input.voyage_no ?? null,
      charterer: input.charterer ?? null,
      port_from: input.port_from ?? null,
      port_to: input.port_to ?? null,
      load_date: input.load_date ?? null,
      discharge_date: input.discharge_date ?? null,
      cargo_type: input.cargo_type ?? null,
      tonnage: input.tonnage ?? null,
      price_per_ton: input.price_per_ton ?? null,
      kwz: input.kwz ?? null,
      total: input.total ?? null,
      revenue: input.revenue ?? null,
      handler_provision: input.handler_provision ?? null,
      demurrage: input.demurrage ?? null,
      fuel: input.fuel ?? null,
      fuel_price: input.fuel_price ?? null,
      oil_cost: input.oil_cost ?? null,
      port_dues_load: input.port_dues_load ?? null,
      port_dues_discharge: input.port_dues_discharge ?? null,
      net: input.net ?? null,
      waiting_days: input.waiting_days ?? null,
      net_per_day: input.net_per_day ?? null,
      gmp: input.gmp ?? null,
      material_cleaned: input.material_cleaned ?? null,
      zhc: input.zhc ?? null,
      note: input.note ?? null,
      source_ref: input.sourceRef ?? null,
      created_by: input.createdBy ?? null,
      status: "confirmed",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to record voyage entry: ${error.message}`);
  return { id: (data as { id: string }).id };
}

// ── Delete (undo) ────────────────────────────────────────────

/**
 * Delete a voyage entry by id — the reversal for a confirmed record action.
 * Hard delete: the entry never should have been booked, so it leaves no trace
 * in the voyage index (the undo path, not a void/adjustment).
 */
export async function deleteVoyageEntry(id: string): Promise<void> {
  if (!id) throw new Error("id is required");
  const db = supabaseAdmin();
  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`Failed to delete voyage entry: ${error.message}`);
}
