import { NextRequest, NextResponse } from "next/server";
import { fail, handle, ok } from "@/lib/http";
import { draftEmail } from "@/lib/agents/draftEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/outlook/draft
 *   { recipient: {name,email,role?,notes?}, intent: string, web?: boolean, sender?: string }
 * AI-drafts a personalized 1:1 email. Works without Microsoft creds — this is
 * the "preparation" step (drafting), separate from sending.
 */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const body = (await req.json()) as {
      recipient?: { name?: string; email?: string; role?: string; notes?: string };
      intent?: string;
      web?: boolean;
      sender?: string;
    };
    if (!body.recipient?.name || !body.recipient.email) {
      return fail("BadRequest: recipient.name and recipient.email are required", 400);
    }
    if (!body.intent) return fail("BadRequest: intent is required", 400);

    const drafted = await draftEmail(
      {
        name: body.recipient.name,
        email: body.recipient.email,
        role: body.recipient.role,
        notes: body.recipient.notes,
      },
      body.intent,
      { web: body.web === true, sender: body.sender },
    );
    return ok(drafted);
  });
}
