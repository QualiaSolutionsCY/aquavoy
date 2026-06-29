/**
 * excelRegister.ts — adapter for reading and appending rows to Wency's
 * "Reis registratie.xlsx" voyage register.
 *
 * Architecture seam: this file owns all xlsx-lib specifics so callers stay
 * vendor-agnostic. The append path NEVER rebuilds the workbook from scratch —
 * it mutates the existing sheet in-place (append-to-bottom) so every existing
 * sheet, row, and column survives.
 */

/** Ordered list of the 26 register field keys — matches the Dutch column order
 *  in Wency's spreadsheet and the voyage_entries migration (ADR-006). */
export const REGISTER_COLUMNS = [
  "voyage_no",
  "charterer",
  "port_from",
  "port_to",
  "load_date",
  "discharge_date",
  "cargo_type",
  "tonnage",
  "price_per_ton",
  "kwz",
  "total",
  "revenue",
  "handler_provision",
  "demurrage",
  "fuel",
  "fuel_price",
  "oil_cost",
  "port_dues_load",
  "port_dues_discharge",
  "net",
  "waiting_days",
  "net_per_day",
  "gmp",
  "material_cleaned",
  "zhc",
  "note",
] as const;

export type RegisterColumn = (typeof REGISTER_COLUMNS)[number];

/** One row of the voyage register — all fields are optional because the real
 *  spreadsheet contains many partially-filled rows. */
export type VoyageRegisterRow = {
  [K in RegisterColumn]?: string | number | null;
};

/** Parsed representation of the workbook — per-sheet array-of-arrays. */
export interface RegisterData {
  sheetNames: string[];
  sheets: Record<string, string[][]>;
}

/**
 * readRegister — parse an .xlsx buffer into per-sheet AOA.
 *
 * Uses `sheet_to_json(sheet, { header: 1, raw: false })` so every cell is
 * returned as a string (dates, numbers, formulas all normalised), matching
 * how the agent's read_file path renders spreadsheet content.
 */
export async function readRegister(buffer: Uint8Array | Buffer): Promise<RegisterData> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });

  const sheets: Record<string, string[][]> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) {
      sheets[name] = [];
      continue;
    }
    sheets[name] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
    }) as string[][];
  }

  return { sheetNames: [...wb.SheetNames], sheets };
}

/**
 * appendVoyageRow — append ONE voyage row to the named year-sheet and return
 * a new .xlsx buffer with all other sheets and existing rows intact.
 *
 * - Does NOT create a sheet if `year` is absent — throws a clear error instead.
 * - Appends to the bottom of the existing sheet without touching any earlier
 *   rows (targets the next empty row after the last populated cell).
 * - Re-serialises with `XLSX.write(wb, { type: "buffer", bookType: "xlsx" })`.
 */
export async function appendVoyageRow(
  buffer: Uint8Array | Buffer,
  year: string,
  row: VoyageRegisterRow,
): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array" });

  const ws = wb.Sheets[year];
  if (!ws) {
    throw new Error(
      `Register has no sheet named "${year}". Available: ${wb.SheetNames.join(", ")}`,
    );
  }

  // Map the row object to an ordered values array (26 values).
  // Empty string for null/undefined so cells stay aligned with the header row.
  const values: (string | number)[] = REGISTER_COLUMNS.map((key) => {
    const v = row[key];
    if (v == null) return "";
    return v;
  });

  // Append to the bottom of the existing sheet.
  XLSX.utils.sheet_add_aoa(ws, [values], { origin: -1 });

  // Re-serialise the whole workbook — all sheets survive unchanged.
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
