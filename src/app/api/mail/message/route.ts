import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";
import { MAILBOXES } from "@/lib/mailboxes";
import { readEmail } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_MAILBOXES = new Set(MAILBOXES.map((m) => m.address.toLowerCase()));

/**
 * GET /api/mail/message?mailbox=<email>&folder=<optional>&uid=<number>
 * Read a single email's full content by UID, read-only.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    if (!getPrincipal(req)) return fail("Unauthorized", 401);

    const params = req.nextUrl.searchParams;
    const mailbox = params.get("mailbox") ?? "";
    if (!KNOWN_MAILBOXES.has(mailbox.toLowerCase())) {
      return fail("Unknown mailbox", 400);
    }

    const uidParam = params.get("uid");
    const uid = Number(uidParam);
    if (uidParam === null || uidParam.trim() === "" || !Number.isInteger(uid) || uid <= 0) {
      return fail("Invalid uid", 400);
    }

    const folder = params.get("folder") ?? undefined;

    return ok(await readEmail(mailbox, folder, uid));
  });
}
