import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { listAccounts, saveAccount, deleteAccount } from "@/lib/mail/accounts";
import { verifySmtp } from "@/lib/mail/smtp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List all mail accounts (no passwords). */
export function GET(): Promise<NextResponse> {
  return handle(async () => ok(await listAccounts()));
}

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive(),
  imapHost: z.string().optional(),
  imapPort: z.number().int().positive().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Add (or update) a mail account. Verifies SMTP first. */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return fail(`Validation error: ${issues}`, 400);
    }
    const body = parsed.data;

    // Verify SMTP credentials before persisting.
    try {
      await verifySmtp({
        host: body.smtpHost,
        port: body.smtpPort,
        username: body.username,
        password: body.password,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SMTP verification failed";
      return fail(message, 400);
    }

    const account = await saveAccount({
      email: body.email,
      displayName: body.displayName,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      imapHost: body.imapHost,
      imapPort: body.imapPort,
      username: body.username,
      password: body.password,
      verifiedAt: new Date().toISOString(),
    });

    return ok(account);
  });
}

/** Delete a mail account by id (query param). */
export function DELETE(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return fail("Missing ?id query parameter", 400);
    await deleteAccount(id);
    return ok({ deleted: true });
  });
}
