import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/lib/auth/session";
import { savePreferences } from "@/lib/notify/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/notify/subscribe — register or replace the principal's push subscription.
 *
 * Auth-gated via session cookie (ADR-001 / REQ-3). NOT added to the cron
 * allowlist in proxy.ts — requires a valid session.
 *
 * Body: PushSubscriptionJSON shape — validated with Zod (rules/security.md).
 * Returns: { ok: true } on success.
 */

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const principal = getPrincipal(req);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid subscription", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await savePreferences(principal, { push_subscription: parsed.data as PushSubscriptionJSON });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save subscription";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
