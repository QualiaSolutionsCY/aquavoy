import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { confirmAction } from "@/lib/agents/pendingActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/actions/confirm { id } — run the staged side-effect for a pending
 * action and record the outcome (ADR-003 §4). The real side-effect runs inside
 * the agents layer, not here. Principal is taken from the verified session
 * cookie, so a confirm only ever touches the signed-in operator's pending rows.
 *
 *   404 — no pending action with that id for this principal.
 *   409 — the action exists but is no longer pending (already resolved).
 *   502 — the side-effect threw while running.
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
    action = await confirmAction(id, principal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Confirm failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // null → no row for this principal (or it belongs to someone else).
  if (!action) {
    return NextResponse.json({ ok: false, error: "Action not found" }, { status: 404 });
  }
  // The action was already resolved before this call — re-confirm is a no-op.
  if (action.status !== "confirmed") {
    return NextResponse.json({ ok: false, error: "not pending" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, data: { action } });
}
