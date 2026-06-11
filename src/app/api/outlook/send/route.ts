import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { createDraft, sendMail } from "@/lib/microsoft/outlook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/outlook/send
 *   { to, subject, body, html?, cc?, connectionId?, mode?: "send"|"draft" }
 * mode "draft" saves to Outlook Drafts (default); "send" sends immediately.
 * Requires a connected Microsoft account (Azure app creds configured).
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const body = (await req.json()) as {
      to?: string;
      subject?: string;
      body?: string;
      html?: boolean;
      cc?: string[];
      connectionId?: string;
      mode?: "send" | "draft";
    };
    if (!body.to || !body.subject || !body.body) {
      return fail("BadRequest: to, subject and body are required", 400);
    }
    const connectionId = await resolveConnectionId(body.connectionId);
    const email = {
      to: body.to,
      subject: body.subject,
      body: body.body,
      html: body.html,
      cc: body.cc,
    };

    if (body.mode === "send") {
      await sendMail(connectionId, email);
      return ok({ sent: true, to: body.to });
    }
    const draft = await createDraft(connectionId, email);
    return ok({ draft: true, ...draft });
  });
}
