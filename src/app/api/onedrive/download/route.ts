import { NextRequest, NextResponse } from "next/server";
import { fail, handle } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { getDownloadUrl } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/onedrive/download?itemId=<fileId>&connectionId=
 * Redirects to a short-lived, pre-authenticated OneDrive CDN URL so the bytes
 * stream straight from Microsoft rather than through our server.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    const itemId = p.get("itemId");
    if (!itemId) return fail("BadRequest: itemId is required", 400);
    const connectionId = await resolveConnectionId(p.get("connectionId"));
    const url = await getDownloadUrl(connectionId, itemId);
    return NextResponse.redirect(url);
  });
}
