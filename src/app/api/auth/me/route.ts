import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 * Returns the verified session principal so the client can learn its own
 * identity (ADR-001). 401 when unauthenticated.
 */
export function GET(req: NextRequest) {
  const principal = getPrincipal(req);
  return principal ? ok({ principal }) : fail("Unauthorized", 401);
}
