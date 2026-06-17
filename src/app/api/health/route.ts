import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Pure liveness probe (M4 Handoff). Returns 200 with {ok:true,...} for uptime
 * monitors. No auth (proxy allowlist), no env secret, no DB/network call.
 */
export function GET() {
  return ok({ status: "ok", ts: new Date().toISOString() });
}
