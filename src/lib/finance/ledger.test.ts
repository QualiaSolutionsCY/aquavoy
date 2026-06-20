import { describe, it, expect, vi } from "vitest";

/**
 * Seam test for the finance ledger aggregation (ADR-005). Supabase is mocked;
 * financeSummary reads:  db.from(T).select(...).eq("status","confirmed")  ->
 * {data,error}. The fixture exercises mixed expense/income across a few of the
 * eight group companies plus an unknown entity; the assertions pin per-company
 * income/expense/net, the consolidated roll-up, and that ALL eight companies
 * appear even when several have no entries.
 */

// ── Fixture: a few companies booked, the rest empty ──────────
// Aquavoy Shipping: income 12,500 + 2,500.50; expense 4,000   → net 11,000.50
// W&D Trading:      expense 1,000.25                           → net -1,000.25
// "Legacy GmbH":    income 999 (NOT one of the eight)          → rolls up only
const fixtureRows = [
  { company: "Aquavoy Shipping", direction: "income", amount: 12500 },
  { company: "Aquavoy Shipping", direction: "income", amount: 2500.5 },
  { company: "Aquavoy Shipping", direction: "expense", amount: 4000 },
  { company: "W&D Trading", direction: "expense", amount: 1000.25 },
  { company: "Legacy GmbH", direction: "income", amount: 999 },
];

function makeDb() {
  return {
    from() {
      return {
        // SELECT chain — select() returns this; the chain is awaited at .eq().
        select() {
          return this;
        },
        eq() {
          return Promise.resolve({ data: fixtureRows, error: null });
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: vi.fn(() => makeDb()),
}));

import { financeSummary, FINANCE_COMPANIES } from "./ledger";

describe("finance/ledger financeSummary", () => {
  it("computes per-company income/expense/net from the fixture", async () => {
    const summary = await financeSummary();

    const shipping = summary.companies.find((c) => c.company === "Aquavoy Shipping");
    expect(shipping).toEqual({
      company: "Aquavoy Shipping",
      income: 15000.5,
      expense: 4000,
      net: 11000.5,
      count: 3,
    });

    const trading = summary.companies.find((c) => c.company === "W&D Trading");
    expect(trading).toEqual({
      company: "W&D Trading",
      income: 0,
      expense: 1000.25,
      net: -1000.25,
      count: 1,
    });
  });

  it("returns all eight group companies, zero-filled where there are no entries", async () => {
    const summary = await financeSummary();

    expect(summary.companies).toHaveLength(8);
    // Order matches the canonical list.
    expect(summary.companies.map((c) => c.company)).toEqual([...FINANCE_COMPANIES]);

    // A booked-against company stays non-zero; an un-booked one is all zeros.
    const holding = summary.companies.find((c) => c.company === "Aquavoy Holding");
    expect(holding).toEqual({
      company: "Aquavoy Holding",
      income: 0,
      expense: 0,
      net: 0,
      count: 0,
    });
  });

  it("rolls up a consolidated total across all rows, including unknown entities", async () => {
    const summary = await financeSummary();

    // income 12500 + 2500.5 + 999 = 15999.5 ; expense 4000 + 1000.25 = 5000.25
    expect(summary.consolidated).toEqual({
      income: 15999.5,
      expense: 5000.25,
      net: 10999.25,
      count: 5,
    });
    expect(summary.currency).toBe("EUR");
  });

  it("does NOT surface an unknown entity as its own company card", async () => {
    const summary = await financeSummary();
    expect(summary.companies.find((c) => c.company === "Legacy GmbH")).toBeUndefined();
  });
});
