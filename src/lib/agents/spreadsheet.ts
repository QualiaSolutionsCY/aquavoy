import * as XLSX from "xlsx-js-style";

/**
 * XLSX generation seam. This is the ONLY file in Aquavoy that knows the SheetJS
 * wire shape (cell objects, `!cols`, `!autofilter`, style descriptors). Callers
 * hand it plain structured data and get back a finished workbook buffer; the
 * rest of the app never touches a WorkSheet directly.
 *
 * We use `xlsx-js-style` rather than the base `xlsx` (SheetJS community) build
 * because the community writer silently drops cell styles — so a bold header
 * never reaches the file. `xlsx-js-style` is a drop-in fork with the identical
 * API that DOES serialize the `s` style descriptor, giving us real bold header
 * cells. Column widths (`!cols`), the autofilter (`!autofilter`), and per-column
 * number formats are honored by both writers.
 *
 * Freeze-pane note: the SheetJS community writer (and this style fork, which
 * shares its `write_ws_xml_sheetviews`) does NOT serialize a frozen pane — that
 * writer only emits `workbookViewId`. There is no worksheet property the
 * community/style build will turn into a frozen header row on write, so we do
 * not ship a no-op `!freeze` config. The header is instead made unmistakable
 * via bold + fill styling and the autofilter dropdowns, which the writer does
 * emit. (Verified: node_modules/xlsx/xlsx.js write_ws_xml_sheetviews ignores any
 * freeze input.)
 */

/** A single sheet: a header row of column labels plus data rows. */
export interface SheetSpec {
  /** Sheet tab name (Excel caps at 31 chars; we sanitize and truncate). */
  name: string;
  /** Column header labels — also the autofilter header. */
  columns: string[];
  /** Data rows. Each inner array aligns to `columns` by index. */
  rows: (string | number)[][];
}

/** The full workbook request: a filename and one or more sheets. */
export interface SpreadsheetSpec {
  /** Desired file name. `.xlsx` is appended if missing. */
  filename: string;
  sheets: SheetSpec[];
}

/** Result of building a workbook: the bytes plus the normalized file name. */
export interface BuiltSpreadsheet {
  /** Node Buffer of the .xlsx — pass straight to uploadFile. */
  buffer: Buffer;
  /** The normalized file name guaranteed to end in `.xlsx`. */
  fileName: string;
}

/** Excel's hard limits we have to respect when naming a sheet tab. */
const SHEET_NAME_MAX = 31;
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

/** Header cell style: bold white text on a deep slate fill, centered. */
const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F3A5F" } },
  alignment: { horizontal: "center" as const, vertical: "center" as const },
};

/** Force a unique, Excel-legal sheet name (deduping with a numeric suffix). */
function safeSheetName(raw: string, taken: Set<string>): string {
  let base = (raw || "Sheet").replace(INVALID_SHEET_CHARS, " ").trim().slice(0, SHEET_NAME_MAX);
  if (!base) base = "Sheet";
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = base.slice(0, SHEET_NAME_MAX - suffix.length) + suffix;
    n += 1;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Normalize a requested file name to end in exactly one `.xlsx`. */
export function normalizeFileName(name: string): string {
  const trimmed = (name || "spreadsheet").trim() || "spreadsheet";
  return /\.xlsx$/i.test(trimmed) ? trimmed : `${trimmed}.xlsx`;
}

/**
 * Compute a sensible width (in characters) for each column from the longest
 * value seen in the header or any row, clamped so a long free-text cell never
 * blows the column out to the full page.
 */
function columnWidths(columns: string[], rows: (string | number)[][]): XLSX.ColInfo[] {
  const MIN = 10;
  const MAX = 60;
  return columns.map((col, c) => {
    let longest = String(col ?? "").length;
    for (const row of rows) {
      const len = String(row[c] ?? "").length;
      if (len > longest) longest = len;
    }
    // +2 for cell padding so text isn't flush against the gridline.
    return { wch: Math.min(MAX, Math.max(MIN, longest + 2)) };
  });
}

/** Build one styled worksheet from a SheetSpec. */
function buildSheet(spec: SheetSpec): XLSX.WorkSheet {
  const columns = spec.columns ?? [];
  const rows = spec.rows ?? [];
  const aoa: (string | number)[][] = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Bold the header row. Header cells live at row 0 (A1, B1, …).
  for (let c = 0; c < columns.length; c += 1) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[ref] as XLSX.CellObject | undefined;
    if (cell) cell.s = HEADER_STYLE;
  }

  // Number-format numeric columns (thousands separator) so figures read as money/
  // counts rather than raw integers. A column is "numeric" when every data cell
  // in it is a number.
  for (let c = 0; c < columns.length; c += 1) {
    const allNumeric =
      rows.length > 0 && rows.every((row) => typeof row[c] === "number");
    if (!allNumeric) continue;
    for (let r = 1; r <= rows.length; r += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = "#,##0.##";
    }
  }

  // Column widths sized to content.
  ws["!cols"] = columnWidths(columns, rows);

  // Autofilter across the header row so the user can sort/filter immediately.
  if (columns.length > 0) {
    const ref = XLSX.utils.encode_range(
      { r: 0, c: 0 },
      { r: rows.length, c: columns.length - 1 },
    );
    ws["!autofilter"] = { ref };
  }

  return ws;
}

/**
 * Build a professionally-formatted .xlsx workbook from structured data and
 * return its bytes as a Node Buffer (ready for uploadFile) plus the normalized
 * file name. Throws only on an empty `sheets` array — every other input is
 * sanitized.
 */
export function buildSpreadsheet(spec: SpreadsheetSpec): BuiltSpreadsheet {
  const sheets = spec.sheets ?? [];
  if (sheets.length === 0) {
    throw new Error("buildSpreadsheet requires at least one sheet.");
  }

  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();
  for (const sheetSpec of sheets) {
    const ws = buildSheet(sheetSpec);
    const name = safeSheetName(sheetSpec.name, taken);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    cellStyles: true,
  }) as Buffer;

  return { buffer, fileName: normalizeFileName(spec.filename) };
}
