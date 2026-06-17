import { NextRequest, NextResponse } from "next/server";
import { getPrincipal } from "@/lib/auth/session";
import { undoAction } from "@/lib/agents/pendingActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/actions/undo { id } — reverse a reversible `confirmed` action
 * (ADR-003 §4/§5). Principal is taken from the verified session cookie, so an
 * undo only ever touches the signed-in operator's own rows.
 *
 *   404 — no action with that id for this principal.
 *   409 — the action exists but cannot be undone (wrong status / irreversible).
 *   502 — the reversal side-effect threw.
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

  let result;
  try {
    result = await undoAction(id, principal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Undo failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // null action → no row for this principal (or it belongs to someone else).
  if (!result.action) {
    return NextResponse.json({ ok: false, error: "Action not found" }, { status: 404 });
  }
  // Not reversible / wrong status — surface why the undo did not happen.
  if (!result.undone) {
    return NextResponse.json(
      { ok: false, error: result.reason ?? "not pending" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, data: { action: result.action } });
}
