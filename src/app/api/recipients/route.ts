import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import {
  createRecipient,
  deleteRecipient,
  type Recipient,
  searchRecipients,
} from "@/lib/recipients";
import { MAILBOXES } from "@/lib/mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A company mailbox surfaced as a suggestion has no DB row, hence a null id. */
type Suggestion = Recipient | (Omit<Recipient, "id"> & { id: null });

/**
 * Build the suggestion pool: crew rows UNION the company mailboxes, deduped by
 * email (a recipient row wins over the bare mailbox since it carries a name).
 * When `q` is set, mailboxes are filtered by the same case-insensitive
 * name/email contains test so "ADM" → admin@aquavoy.com works on an empty table.
 */
function mergeWithMailboxes(rows: Recipient[], q: string): Suggestion[] {
  const needle = q.trim().toLowerCase();
  const byEmail = new Map<string, Suggestion>();
  for (const r of rows) byEmail.set(r.email.toLowerCase(), r);
  for (const mb of MAILBOXES) {
    const key = mb.address.toLowerCase();
    if (byEmail.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    byEmail.set(key, {
      id: null,
      name: mb.address.split("@")[0],
      email: mb.address,
      role: mb.group,
      notes: null,
    });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/** GET /api/recipients[?q=prefix] — list the crew, or search crew + mailboxes. */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const rows = await searchRecipients(q);
    return ok(mergeWithMailboxes(rows, q));
  });
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
