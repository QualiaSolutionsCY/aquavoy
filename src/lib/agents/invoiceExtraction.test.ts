import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam tests for `extractInvoiceFields`.
 *
 * `complete()` from `@/lib/openrouter/client` is mocked — no live LLM call.
 * Covers:
 *   AC1 — valid model JSON → fully parsed ExtractedInvoice
 *   AC2 — missing required `total` → throws validation error
 *   AC3 — invalid `company` value → throws naming the invalid field
 *   AC4 — missing optional amounts default to "0.00"
 *   AC5 — model wraps JSON in code fences → still parsed correctly
 */

const { completeMock } = vi.hoisted(() => ({
  completeMock: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/lib/openrouter/client", () => ({
  complete: completeMock,
}));

import { extractInvoiceFields, ExtractedInvoiceSchema } from "./invoiceExtraction";

const VALID_RESPONSE = JSON.stringify({
  company: "Gefo",
  recipient_name: "Gefo Reederei GmbH",
  recipient_address: "Große Elbstraße 145, 22767 Hamburg",
  recipient_vat: "DE123456789",
  vessel: "Pride of Faial",
  invoice_date: "27-06-2026",
  invoice_number: "26-047",
  crewing: 4500.0,
  travel: 350.0,
  service_fee: 200.0,
  cash_advance: 500.0,
  total: 4550.0,
  currency: "EUR",
});

beforeEach(() => {
  completeMock.mockReset();
});

describe("extractInvoiceFields — valid model response", () => {
  it("returns a fully validated ExtractedInvoice for a valid JSON response", async () => {
    completeMock.mockResolvedValueOnce(VALID_RESPONSE);

    const result = await extractInvoiceFields("some pdf text");

    expect(result.company).toBe("Gefo");
    expect(result.recipient_name).toBe("Gefo Reederei GmbH");
    expect(result.vessel).toBe("Pride of Faial");
    expect(result.total).toBe("4550.00");
    expect(result.crewing).toBe("4500.00");
    expect(result.currency).toBe("EUR");
  });

  it("strips code fences before parsing", async () => {
    completeMock.mockResolvedValueOnce("```json\n" + VALID_RESPONSE + "\n```");

    const result = await extractInvoiceFields("some pdf text");
    expect(result.company).toBe("Gefo");
    expect(result.total).toBe("4550.00");
  });

  it("strips bare code fences (no language tag)", async () => {
    completeMock.mockResolvedValueOnce("```\n" + VALID_RESPONSE + "\n```");

    const result = await extractInvoiceFields("some pdf text");
    expect(result.company).toBe("Gefo");
  });
});

describe("extractInvoiceFields — optional amounts default to '0.00'", () => {
  it("defaults crewing, travel, service_fee, cash_advance to '0.00' when absent", async () => {
    const minimal = JSON.stringify({
      company: "Novo Porto",
      recipient_name: "Novo Porto Scheepvaart BV",
      recipient_address: "Wilhelminaplein 1, 2074 DE Rotterdam",
      recipient_vat: "NL819154064B01",
      vessel: "Pride of Faial",
      invoice_date: "27-06-2026",
      invoice_number: "26-048",
      total: 1000.0,
      // crewing, travel, service_fee, cash_advance, currency omitted
    });
    completeMock.mockResolvedValueOnce(minimal);

    const result = await extractInvoiceFields("minimal pdf text");

    expect(result.crewing).toBe("0.00");
    expect(result.travel).toBe("0.00");
    expect(result.service_fee).toBe("0.00");
    expect(result.cash_advance).toBe("0.00");
    expect(result.currency).toBe("EUR");
  });

  it("coerces string amounts to '0.00' for missing numeric amounts", async () => {
    const withStringAmounts = JSON.stringify({
      company: "Gefo",
      recipient_name: "Gefo Reederei GmbH",
      recipient_address: "Hamburg",
      recipient_vat: "DE123",
      vessel: "Aquavoy One",
      invoice_date: "01-01-2026",
      invoice_number: "26-001",
      crewing: "1500.50",
      travel: "0",
      service_fee: "notanumber",
      cash_advance: 0,
      total: "1500.50",
    });
    completeMock.mockResolvedValueOnce(withStringAmounts);

    const result = await extractInvoiceFields("pdf text");

    expect(result.crewing).toBe("1500.50");
    expect(result.travel).toBe("0.00");
    // "notanumber" → NaN → "0.00"
    expect(result.service_fee).toBe("0.00");
    expect(result.cash_advance).toBe("0.00");
    expect(result.total).toBe("1500.50");
  });
});

describe("extractInvoiceFields — schema validation failures", () => {
  it("throws naming 'total' when the field is missing", async () => {
    const missingTotal = JSON.stringify({
      company: "Gefo",
      recipient_name: "Gefo Reederei GmbH",
      recipient_address: "Hamburg",
      recipient_vat: "DE123",
      vessel: "Aquavoy One",
      invoice_date: "01-01-2026",
      invoice_number: "26-001",
      // total is missing
    });
    completeMock.mockResolvedValueOnce(missingTotal);

    await expect(extractInvoiceFields("pdf text")).rejects.toThrow(
      /invoice extraction failed validation:.*total/i,
    );
  });

  it("throws naming 'company' when the value is not 'Gefo' or 'Novo Porto'", async () => {
    const badCompany = JSON.stringify({
      company: "Unknown Corp",
      recipient_name: "Test",
      recipient_address: "Somewhere",
      recipient_vat: "NL000",
      vessel: "Test Vessel",
      invoice_date: "01-01-2026",
      invoice_number: "26-001",
      total: 500,
    });
    completeMock.mockResolvedValueOnce(badCompany);

    await expect(extractInvoiceFields("pdf text")).rejects.toThrow(
      /invoice extraction failed validation:.*company/i,
    );
  });

  it("throws when the model returns non-JSON", async () => {
    completeMock.mockResolvedValueOnce("Sorry, I cannot extract that information.");

    await expect(extractInvoiceFields("pdf text")).rejects.toThrow(
      /invoice extraction failed/i,
    );
  });
});

describe("ExtractedInvoiceSchema (exported)", () => {
  it("is a valid Zod schema that parses a correct object", () => {
    const data = {
      company: "Novo Porto",
      recipient_name: "NP BV",
      recipient_address: "Rotterdam",
      recipient_vat: "NL000",
      vessel: "Faial",
      invoice_date: "01-06-2026",
      invoice_number: "26-010",
      total: 2000,
    };
    const result = ExtractedInvoiceSchema.parse(data);
    expect(result.company).toBe("Novo Porto");
    expect(result.total).toBe("2000.00");
  });
});
