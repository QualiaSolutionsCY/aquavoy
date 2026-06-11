import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { loadAccountWithSecret } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

/** Send an email via a stored mail account. */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const parsed = sendSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return fail(`Validation error: ${issues}`, 400);
    }
    const { accountId, to, subject, body } = parsed.data;

    const account = await loadAccountWithSecret(accountId);

    try {
      await sendMail({ account, to, subject, body });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send email";
      return fail(message, 502);
    }

    return ok({ sent: true });
  });
}
