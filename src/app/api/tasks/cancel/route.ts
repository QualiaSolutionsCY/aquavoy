import { NextRequest, NextResponse } from "next/server";
import { handle, ok, fail } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";
import { cancelTask } from "@/lib/agents/scheduledTasks";
import { cancelScheduled } from "@/lib/mail/scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/tasks/cancel?id={id}&kind={reminder|email}
 * Cancels a pending task owned by the calling principal. Principal isolation
 * (REQ-3): the underlying cancelTask/cancelScheduled functions scope the cancel
 * to the principal so one operator cannot cancel another's rows.
 */
export function DELETE(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return fail("Missing ?id query parameter", 400);

    const kind = req.nextUrl.searchParams.get("kind");
    if (kind !== "reminder" && kind !== "email") {
      return fail("Missing or invalid ?kind (reminder|email)", 400);
    }

    const row =
      kind === "reminder"
        ? await cancelTask(id, principal)
        : await cancelScheduled(id, principal);

    return ok(row);
  });
}
