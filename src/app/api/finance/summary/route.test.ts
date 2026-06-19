import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Seam test for GET /api/finance/summary (ADR-005 read side). The session
 * adapter (getPrincipal) and the ledger module (financeSummary) are mocked so
 * the route's HTTP contract is tested in isolation — no cookie crypto, no
 * Supabase, no aggregation. Asserts:
 *   - 401 when there is no verified principal, and financeSummary is never run.
 *   - 200 + the { ok: true, data } envelope wrapping the summary when the
 *     principal is present.
 *   - errors thrown by financeSummary surface as a 500 fail envelope (handle()).
 */

const { getPrincipalMock, financeSummaryMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  financeSummaryMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getPrincipal: getPrincipalMock }));
vi.mock("@/lib/finance/ledger", () => ({ financeSummary: financeSummaryMock }));

import { GET } from "./route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/finance/summary");
}

const summary = {
  currency: "EUR",
  companies: [
    { company: "Aquavoy Shipping", income: 1000, expense: 400, net: 600, count: 3 },
  ],
  consolidated: { income: 1000, expense: 400, net: 600, count: 3 },
};

beforeEach(() => {
  getPrincipalMock.mockReset();
  financeSummaryMock.mockReset();
});

describe("GET /api/finance/summary", () => {
  it("returns 401 and never aggregates when there is no verified principal", async () => {
    getPrincipalMock.mockReturnValue(null);
    const res = await GET(req());
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(financeSummaryMock).not.toHaveBeenCalled();
  });

  it("returns 200 + the summary wrapped in the ok envelope for a verified principal", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    financeSummaryMock.mockResolvedValue(summary);
    const res = await GET(req());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data).toEqual(summary);
    expect(json.data.consolidated.net).toBe(600);
    expect(financeSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an aggregation failure as a 500 fail envelope", async () => {
    getPrincipalMock.mockReturnValue("Jeanette");
    financeSummaryMock.mockRejectedValue(new Error("index unavailable"));
    const res = await GET(req());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("index unavailable");
  });
});
