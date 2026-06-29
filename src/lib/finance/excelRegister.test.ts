/**
 * excelRegister.test.ts — round-trip test for the xlsx register adapter.
 *
 * The test builds an in-memory workbook (using book_new + aoa_to_sheet, which
 * is acceptable ONLY in the test fixture — the production append path never
 * rebuilds from scratch), runs appendVoyageRow, then calls readRegister on the
 * output and asserts:
 *   - "2026" sheet now has 3 data rows (was 2).
 *   - "2025" sheet is untouched (still 1 header + 2 data rows = 3 rows total).
 *   - Sheet order is preserved.
 */

import { describe, it, expect } from "vitest";
import { readRegister, appendVoyageRow, REGISTER_COLUMNS } from "./excelRegister";

async function buildFixtureBuffer(): Promise<Uint8Array> {
  const XLSX = await import("xlsx");

  // 2025 sheet — 1 header row + 2 data rows
  const header2025 = REGISTER_COLUMNS.map((c) => c.toUpperCase());
  const data2025: (string | number)[][] = [
    header2025,
    ["V-2025-001", "Charterer A", "Rotterdam", "Antwerp", "01-01-2025", "05-01-2025",
     "Grain", 1000, 15, "", 15000, 14250, 712.5, 200, 500, 1.2, 600, 150, 150,
     12500, 2, 6250, "", "yes", "", "First voyage"],
    ["V-2025-002", "Charterer B", "Hamburg", "Ghent", "15-01-2025", "20-01-2025",
     "Coal", 2000, 12, "", 24000, 22800, 1140, 300, 800, 1.2, 960, 200, 200,
     20000, 3, 6667, "", "yes", "", "Second voyage"],
  ];

  // 2026 sheet — 1 header row + 2 data rows
  const header2026 = REGISTER_COLUMNS.map((c) => c.toUpperCase());
  const data2026: (string | number)[][] = [
    header2026,
    ["V-2026-001", "Charterer C", "Rotterdam", "Bremen", "10-02-2026", "14-02-2026",
     "Steel", 1500, 18, "", 27000, 25650, 1282.5, 250, 600, 1.3, 780, 180, 180,
     22500, 1, 22500, "", "no", "", ""],
    ["V-2026-002", "Charterer D", "Antwerp", "Rotterdam", "20-02-2026", "22-02-2026",
     "Grain", 800, 20, "", 16000, 15200, 760, 100, 300, 1.3, 390, 90, 90,
     13500, 0, 0, "", "yes", "", ""],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data2025), "2025");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data2026), "2026");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

describe("excelRegister", () => {
  it("readRegister returns sheetNames and per-sheet AOA", async () => {
    const buf = await buildFixtureBuffer();
    const result = await readRegister(buf);

    expect(result.sheetNames).toEqual(["2025", "2026"]);
    expect(result.sheets["2025"]).toBeDefined();
    expect(result.sheets["2026"]).toBeDefined();
    // Header + 2 data rows each
    expect(result.sheets["2025"].length).toBe(3);
    expect(result.sheets["2026"].length).toBe(3);
  });

  it("appendVoyageRow throws when the year sheet does not exist", async () => {
    const buf = await buildFixtureBuffer();
    await expect(
      appendVoyageRow(buf, "2027", { voyage_no: "V-2027-001" }),
    ).rejects.toThrow(/no sheet named "2027"/);
    await expect(
      appendVoyageRow(buf, "2027", { voyage_no: "V-2027-001" }),
    ).rejects.toThrow(/Available: 2025, 2026/);
  });

  it("appendVoyageRow round-trip: 2026 gains one row, 2025 is untouched, sheet order preserved", async () => {
    const buf = await buildFixtureBuffer();

    const newRow = {
      voyage_no: "V-2026-003",
      charterer: "Charterer E",
      port_from: "Hamburg",
      port_to: "Rotterdam",
      load_date: "01-03-2026",
      discharge_date: "03-03-2026",
      cargo_type: "Fertiliser",
      tonnage: 1200,
      price_per_ton: 22,
      revenue: 26400,
      net: 20000,
    };

    const newBuf = await appendVoyageRow(buf, "2026", newRow);

    // Re-read the returned buffer
    const result = await readRegister(newBuf);

    // Sheet order preserved
    expect(result.sheetNames).toEqual(["2025", "2026"]);

    // 2026: header + 2 original + 1 appended = 4 rows
    expect(result.sheets["2026"].length).toBe(4);

    // 2025: unchanged — header + 2 data rows = 3 rows
    expect(result.sheets["2025"].length).toBe(3);

    // The appended row's first cell matches voyage_no
    const appendedRow = result.sheets["2026"][3];
    expect(appendedRow).toBeDefined();
    expect(appendedRow[0]).toBe("V-2026-003");

    // Columns align — voyage_no is index 0, charterer is index 1
    expect(appendedRow[1]).toBe("Charterer E");

    // tonnage is index 7 (REGISTER_COLUMNS order)
    const tonnageIdx = REGISTER_COLUMNS.indexOf("tonnage");
    expect(Number(appendedRow[tonnageIdx])).toBe(1200);

    // null/undefined fields are empty string
    const gmpIdx = REGISTER_COLUMNS.indexOf("gmp");
    expect(appendedRow[gmpIdx]).toBe("");
  });

  it("appendVoyageRow returns a Buffer-compatible value", async () => {
    const buf = await buildFixtureBuffer();
    const newBuf = await appendVoyageRow(buf, "2026", { voyage_no: "V-test" });
    // Should be usable as Uint8Array (uploadFile in onedrive.ts accepts both)
    expect(newBuf.byteLength).toBeGreaterThan(0);
  });
});
