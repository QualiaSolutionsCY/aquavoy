import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrincipal } from "@/lib/auth/session";
import { loadPreferences, savePreferences } from "@/lib/notify/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notify/preferences — return the session principal's notification prefs.
 * POST /api/notify/preferences — update opt-in events and/or quiet hours.
 *
 * Auth-gated via session cookie (ADR-001 / REQ-3). NOT added to the cron
 * allowlist in proxy.ts — requires a valid session.
 *
 * The push_subscription field is NOT settable here — use POST /api/notify/subscribe.
 * Both routes go through the preferences.ts helper so principal-scoping lives in
 * one place (rules/architecture.md §2 — locality).
 */

/** "HH:MM" or null — Postgres time columns are stored/returned in this format. */
const TimeOrNull = z
  .string()
  .regex(/^\d{2}:\d{2}$/, { message: "must be HH:MM" })
  .nullable()
  .optional();

const PreferencesPatchSchema = z.object({
  enabled_events: z.array(z.string()).optional(),
  quiet_hours_start: TimeOrNull,
  quiet_hours_end: TimeOrNull,
});

export async function GET(req: NextRequest) {
  const principal = getPrincipal(req);
  if (!principal) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prefs = await loadPreferences(principal);
    return NextResponse.json({ ok: true, data: prefs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load preferences";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

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

  const parsed = PreferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid preferences", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Build the patch — push_subscription is intentionally excluded here.
  const patch: Parameters<typeof savePreferences>[1] = {};
  if (parsed.data.enabled_events !== undefined) {
    patch.enabled_events = parsed.data.enabled_events;
  }
  if (parsed.data.quiet_hours_start !== undefined) {
    patch.quiet_hours_start = parsed.data.quiet_hours_start ?? null;
  }
  if (parsed.data.quiet_hours_end !== undefined) {
    patch.quiet_hours_end = parsed.data.quiet_hours_end ?? null;
  }

  try {
    const updated = await savePreferences(principal, patch);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update preferences";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
