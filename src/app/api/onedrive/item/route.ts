import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { copyItem, deleteItem, updateItem } from "@/lib/microsoft/onedrive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/onedrive/item?itemId=&connectionId= — delete an item. */
export function DELETE(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    const itemId = p.get("itemId");
    if (!itemId) return fail("BadRequest: itemId is required", 400);
    const connectionId = await resolveConnectionId(p.get("connectionId"));
    await deleteItem(connectionId, itemId);
    return ok({ deleted: itemId });
  });
}

/**
 * PATCH /api/onedrive/item
 *   { itemId, connectionId?, newName?, newParentId? }        → rename / move
 *   { itemId, connectionId?, copyToParentId, newName? }      → copy
 */
export function PATCH(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const body = (await req.json()) as {
      itemId?: string;
      connectionId?: string;
      newName?: string;
      newParentId?: string;
      copyToParentId?: string;
    };
    if (!body.itemId) return fail("BadRequest: itemId is required", 400);
    const connectionId = await resolveConnectionId(body.connectionId);

    if (body.copyToParentId) {
      await copyItem(connectionId, body.itemId, body.copyToParentId, body.newName);
      return ok({ copying: body.itemId, to: body.copyToParentId });
    }

    if (!body.newName && !body.newParentId) {
      return fail("BadRequest: provide newName, newParentId, or copyToParentId", 400);
    }
    const item = await updateItem(connectionId, body.itemId, {
      newName: body.newName,
      newParentId: body.newParentId,
    });
    return ok(item);
  });
}
