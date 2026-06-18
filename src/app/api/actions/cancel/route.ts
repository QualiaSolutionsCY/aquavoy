import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { cancelAction } from "@/lib/agents/pendingActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/actions/cancel { id } — mark a pending action `cancelled` with no
 * side-effect (ADR-003 §4). Principal is taken from the verified session cookie,
 * so a cancel only ever touches the signed-in operator's own pending rows.
 *
 *   404 — no pending action with that id for this principal.
 *   409 — the action exists but is no longer pending (already resolved).
 *   502 — the cancel write failed.
 */
export async function POST(req: NextRequest) {
  const principal = getPrincipal(req);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let id: string;
  try {
    const body = (await req.json()) as { id?: unknown };
    if (typeof body.id !== "string" || body.id.length === 0) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }
    id = body.id;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  let action;
  try {
    action = await cancelAction(id, principal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // null → no row for this principal (or it belongs to someone else).
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action not found" }, { status: 404 });
  }
  // The action was already resolved before this call — cancel hit 0 rows.
  if (action.status !== "cancelled") {
    return NextResponse.json({ ok: false, error: "not pending" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, data: { action } });
}
