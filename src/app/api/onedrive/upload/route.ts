import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { uploadFile } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onedrive/upload  (multipart/form-data)
 *   file:          the binary (required)
 *   connectionId:  optional, defaults to most-recent connection
 *   parentItemId:  optional destination folder id
 *   parentPath:    optional destination folder path (e.g. /Documents)
 *   name:          optional override filename
 * Small files go via simple PUT; large files via a resumable upload session.
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("BadRequest: 'file' field is required", 400);

    const connectionId = await resolveConnectionId(
      (form.get("connectionId") as string | null) ?? undefined,
    );
    const parentItemId = (form.get("parentItemId") as string | null) ?? undefined;
    const parentPath = (form.get("parentPath") as string | null) ?? undefined;
    const name = (form.get("name") as string | null) || file.name;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const item = await uploadFile(
      connectionId,
      { itemId: parentItemId, path: parentPath },
      name,
      bytes,
      file.type || "application/octet-stream",
    );
    return ok(item, { status: 201 });
  });
}
