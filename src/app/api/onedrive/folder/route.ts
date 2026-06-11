import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { createFolder } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onedrive/folder   { name, connectionId?, parentItemId?, parentPath? }
 * Creates a folder (drive root by default).
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const body = (await req.json()) as {
      name?: string;
      connectionId?: string;
      parentItemId?: string;
      parentPath?: string;
    };
    if (!body.name) return fail("BadRequest: 'name' is required", 400);
    const connectionId = await resolveConnectionId(body.connectionId);
    const item = await createFolder(
      connectionId,
      { itemId: body.parentItemId, path: body.parentPath },
      body.name,
    );
    return ok(item, { status: 201 });
  });
}
