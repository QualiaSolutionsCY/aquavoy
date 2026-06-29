import { describe, it, expect, vi } from "vitest";

/**
 * Seam test for the voyage ledger aggregation (ADR-006). Supabase is mocked;
 * voyageSummary reads: db.from(T).select(...).eq("status","confirmed") ->
 * {data,error}. The fixture exercises revenue/net across a few of the eight
 * group companies plus an unknown entity; the assertions pin per-company
 * voyageCount/revenue/net, the consolidated roll-up, and that ALL eight
 * companies appear even when several have no voyages.
 */

// ── Fixture ──────────────────────────────────────────────────
// Aquavoy Shipping: revenue 15000, net 12000
//                  revenue 5000,  net 3500    → total revenue 20000, net 15500
// Novo Porto:       revenue 8000,  net 6000
// "Old Fleet BV":   revenue 1000,  net 800    (NOT one of the eight — rolls up only)
const fixtureRows = [
  { company: "Aquavoy Shipping", revenue: 15000, net: 12000 },
  { company: "Aquavoy Shipping", revenue: 5000, net: 3500 },
  { company: "Novo Porto Scheepvaart BV", revenue: 8000, net: 6000 },
  { company: "Old Fleet BV", revenue: 1000, net: 800 },
];

function makeDb() {
  return {
    from() {
      return {
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

import { voyageSummary, VOYAGE_COMPANIES } from "./voyageLedger";

describe("finance/voyageLedger voyageSummary", () => {
  it("computes per-company voyageCount/revenue/net from the fixture", async () => {
    const summary = await voyageSummary();

    const shipping = summary.companies.find((c) => c.company === "Aquavoy Shipping");
    expect(shipping).toEqual({
      company: "Aquavoy Shipping",
      voyageCount: 2,
      revenue: 20000,
      net: 15500,
    });

    const novoporto = summary.companies.find(
      (c) => c.company === "Novo Porto Scheepvaart BV",
    );
    expect(novoporto).toEqual({
      company: "Novo Porto Scheepvaart BV",
      voyageCount: 1,
      revenue: 8000,
      net: 6000,
    });
  });

  it("returns all eight group companies, zero-filled where there are no voyages", async () => {
    const summary = await voyageSummary();

    expect(summary.companies).toHaveLength(8);
    // Order matches the canonical list.
    expect(summary.companies.map((c) => c.company)).toEqual([...VOYAGE_COMPANIES]);

    // An un-booked company is all zeros.
    const holding = summary.companies.find((c) => c.company === "Aquavoy Holding");
    expect(holding).toEqual({
      company: "Aquavoy Holding",
      voyageCount: 0,
      revenue: 0,
      net: 0,
    });
  });

  it("rolls up a consolidated total across all rows, including unknown entities", async () => {
    const summary = await voyageSummary();

    // revenue: 15000+5000+8000+1000=29000; net: 12000+3500+6000+800=22300
    expect(summary.consolidated).toEqual({
      voyageCount: 4,
      revenue: 29000,
      net: 22300,
    });
  });

  it("does NOT surface an unknown entity as its own company card", async () => {
    const summary = await voyageSummary();
    expect(summary.companies.find((c) => c.company === "Old Fleet BV")).toBeUndefined();
  });

  it("handles null revenue/net gracefully (treats null as 0)", async () => {
    const nullRows = [{ company: "Aquavoy Shipping", revenue: null, net: null }];
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    vi.mocked(supabaseAdmin).mockReturnValueOnce({
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return Promise.resolve({ data: nullRows, error: null });
          },
        };
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const summary = await voyageSummary();
    const shipping = summary.companies.find((c) => c.company === "Aquavoy Shipping");
    expect(shipping?.revenue).toBe(0);
    expect(shipping?.net).toBe(0);
    expect(shipping?.voyageCount).toBe(1);
  });
});
