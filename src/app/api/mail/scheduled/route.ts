import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { scheduleEmail, listScheduled, cancelScheduled } from "@/lib/mail/scheduled";
import { getPrincipal } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List scheduled emails (most recent 50) for the verified principal. */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);
    return ok(await listScheduled(principal));
  });
}

const scheduleSchema = z.object({
  fromEmail: z.string().email(),
  toEmail: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  scheduledAt: z
    .string()
    .refine(
      (v) => {
        const d = new Date(v);
        return !isNaN(d.getTime()) && d.getTime() > Date.now();
      },
      { message: "scheduledAt must be a valid future ISO-8601 datetime" },
    ),
});

/** Schedule an email for future delivery. */
export function POST(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);
    const parsed = scheduleSchema.safeParse(await req.json());
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return fail(`Validation error: ${issues}`, 400);
    }
    const { fromEmail, toEmail, subject, body, scheduledAt } = parsed.data;
    const row = await scheduleEmail({
      fromEmail,
      toEmail,
      subject,
      body,
      scheduledAt,
      createdBy: principal,
    });
    return ok(row);
  });
}

/** Cancel a scheduled email (must still be pending). */
export function DELETE(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return fail("Missing ?id query parameter", 400);
    const row = await cancelScheduled(id, principal);
    return ok(row);
  });
}
