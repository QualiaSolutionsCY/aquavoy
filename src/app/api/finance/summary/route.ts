import { NextRequest, NextResponse } from "next/server";
import { handle, ok, fail } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";
import { financeSummary } from "@/lib/finance/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/finance/summary — consolidated + per-company income/expense/net for
 * the group's finance index (ADR-005). Principal-gated via the verified session
 * cookie (ADR-001); never derives identity from the request body. Aggregation
 * lives in the ledger module — this route only gates and envelopes it.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);
    return ok(await financeSummary());
  });
}
