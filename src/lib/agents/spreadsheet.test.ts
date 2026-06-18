import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx-js-style";
import { buildSpreadsheet, normalizeFileName } from "./spreadsheet";

/**
 * Seam test for the XLSX generator. Nothing is mocked — we build a workbook from
 * sample data, then read the produced buffer back with the same library and
 * assert the sheet name, header row, data rows, autofilter, and column widths
 * survive the round-trip. The non-empty-buffer assertion proves a real .xlsx was
 * serialized (a SheetJS .xlsx is a zip, so it starts with the "PK" signature).
 */

const SAMPLE = {
  filename: "invoices-2026",
  sheets: [
    {
      name: "Invoices",
      columns: ["Invoice", "Company", "Amount"],
      rows: [
        ["26-047", "Aquavoy Ltd", 1250.5],
        ["26-048", "Faial BV", 980],
      ] as (string | number)[][],
    },
  ],
};

describe("agents/spreadsheet buildSpreadsheet", () => {
  it("appends .xlsx to the filename when missing", () => {
    expect(normalizeFileName("invoices-2026")).toBe("invoices-2026.xlsx");
    expect(normalizeFileName("report.xlsx")).toBe("report.xlsx");
    expect(buildSpreadsheet(SAMPLE).fileName).toBe("invoices-2026.xlsx");
  });

  it("produces a non-empty .xlsx buffer (zip 'PK' signature)", () => {
    const { buffer } = buildSpreadsheet(SAMPLE);
    expect(buffer.byteLength).toBeGreaterThan(0);
    // .xlsx is a ZIP container; every ZIP starts with the bytes "PK".
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it("round-trips the sheet name, header, and rows", () => {
    const { buffer } = buildSpreadsheet(SAMPLE);
    const wb = XLSX.read(buffer, { type: "buffer" });

    expect(wb.SheetNames).toEqual(["Invoices"]);

    const ws = wb.Sheets["Invoices"];
    const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 });

    // Header row + 2 data rows.
    expect(aoa[0]).toEqual(["Invoice", "Company", "Amount"]);
    expect(aoa[1]).toEqual(["26-047", "Aquavoy Ltd", 1250.5]);
    expect(aoa[2]).toEqual(["26-048", "Faial BV", 980]);
  });

  it("serializes column widths and an autofilter into the sheet XML", () => {
    // The SheetJS community reader does not reconstruct write-only props
    // (`!cols`, `!autofilter`) on read — so we verify them where they actually
    // land: the sheet's XML inside the .xlsx zip (exposed via bookFiles).
    const { buffer } = buildSpreadsheet(SAMPLE);
    const wb = XLSX.read(buffer, { type: "buffer", bookFiles: true });
    const files = (wb as unknown as { files: Record<string, { content?: unknown }> }).files;
    const sheetKey = Object.keys(files).find((k) => /worksheets\/sheet1\.xml$/.test(k));
    expect(sheetKey).toBeTruthy();
    const raw = files[sheetKey as string].content;
    const xml = typeof raw === "string" ? raw : Buffer.from(raw as Uint8Array).toString();

    // <cols> block with three <col> width entries.
    expect(xml).toMatch(/<cols>/);
    expect((xml.match(/<col\b/g) ?? []).length).toBe(3);
    // Autofilter spans 3 columns (A..C) over header + 2 data rows → A1:C3.
    expect(xml).toMatch(/autoFilter[^>]*ref="A1:C3"/);
  });

  it("sanitizes and dedupes illegal/duplicate sheet names", () => {
    const { buffer } = buildSpreadsheet({
      filename: "multi",
      sheets: [
        { name: "Q1/Q2", columns: ["A"], rows: [["x"]] },
        { name: "Q1 Q2", columns: ["A"], rows: [["y"]] },
      ],
    });
    const wb = XLSX.read(buffer, { type: "buffer" });
    // "Q1/Q2" → "Q1 Q2"; the second collides and gets a numeric suffix.
    expect(wb.SheetNames).toEqual(["Q1 Q2", "Q1 Q2 (2)"]);
  });

  it("throws when no sheets are provided", () => {
    expect(() => buildSpreadsheet({ filename: "empty", sheets: [] })).toThrow();
  });
});
