import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { createRecipient, deleteRecipient, listRecipients } from "@/lib/recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/recipients — list the crew. */
export function GET(): Promise<NextResponse> {
  return handle(async () => ok(await listRecipients()));
}

/** POST /api/recipients  { name, email, role?, notes? } */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      role?: string;
      notes?: string;
    };
    if (!body.name || !body.email) return fail("BadRequest: name and email are required", 400);
    return ok(
      await createRecipient({
        name: body.name,
        email: body.email,
        role: body.role,
        notes: body.notes,
      }),
      { status: 201 },
    );
  });
}

/** DELETE /api/recipients?id= */
export function DELETE(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return fail("BadRequest: id is required", 400);
    await deleteRecipient(id);
    return ok({ deleted: id });
  });
}
