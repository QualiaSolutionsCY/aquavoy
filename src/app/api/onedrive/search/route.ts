import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { search } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/onedrive/search?q=report&connectionId= — full-text drive search. */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    const q = p.get("q");
    if (!q) return fail("BadRequest: query 'q' is required", 400);
    const connectionId = await resolveConnectionId(p.get("connectionId"));
    return ok(await search(connectionId, q));
  });
}
