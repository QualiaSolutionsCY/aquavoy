import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { listChildren } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/onedrive/files?connectionId=&path=/Documents
 *   or ?itemId=<folderId>
 * Lists children of a folder (drive root by default).
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    const connectionId = await resolveConnectionId(p.get("connectionId"));
    const itemId = p.get("itemId") ?? undefined;
    const path = p.get("path") ?? undefined;
    return ok(await listChildren(connectionId, { itemId, path }));
  });
}
