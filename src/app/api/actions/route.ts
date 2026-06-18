import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { listPendingActions } from "@/lib/agents/pendingActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/actions — list the session principal's still-pending actions
 * (ADR-003 §4). Principal comes from the verified session cookie (ADR-001 /
 * REQ-3), never from the request — the listing is scoped to the operator who is
 * actually signed in.
 */
export async function GET(req: NextRequest) {
  const principal = getPrincipal(req);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const actions = await listPendingActions(principal);
    return NextResponse.json({ ok: true, data: { actions } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list actions";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
