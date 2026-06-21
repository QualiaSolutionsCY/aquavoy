import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { getTrace } from "@/lib/agents/traces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/traces/[id]
 * Returns a stored agent trace as { ok: true, data: AgentTrace }; unknown id →
 * 404 { ok: false }. The acting principal is derived from the verified session
 * cookie (ADR-001) — the route derives nothing from the request body. 401 when
 * no verified principal, matching the chat route.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const principal = getPrincipal(req);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const trace = await getTrace(id, principal);
    if (!trace) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: trace });
  } catch (err) {
    // getTrace throws on DB failure — return the standard envelope, not a raw 500.
    const message = err instanceof Error ? err.message : "Failed to load trace";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
