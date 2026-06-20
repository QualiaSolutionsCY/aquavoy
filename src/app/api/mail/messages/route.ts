import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";
import { MAILBOXES } from "@/lib/mailboxes";
import { listEmails } from "@/lib/mail/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_MAILBOXES = new Set(MAILBOXES.map((m) => m.address.toLowerCase()));

/**
 * GET /api/mail/messages?mailbox=<email>&folder=<INBOX>&count=<20>
 * List the most recent envelopes in a folder (newest first), read-only.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    if (!getPrincipal(req)) return fail("Unauthorized", 401);

    const params = req.nextUrl.searchParams;
    const mailbox = params.get("mailbox") ?? "";
    if (!KNOWN_MAILBOXES.has(mailbox.toLowerCase())) {
      return fail("Unknown mailbox", 400);
    }

    const folder = params.get("folder") ?? "INBOX";
    const countParam = params.get("count");
    const parsedCount = countParam !== null ? Number(countParam) : NaN;
    const count = Number.isFinite(parsedCount) ? parsedCount : 20;

    return ok(await listEmails(mailbox, folder, count));
  });
}
