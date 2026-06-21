import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { runDue } from "@/lib/mail/scheduled";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint: send all due scheduled emails. Protected by a bearer token
 * matching CRON_SECRET (set in .env.local and Vercel env vars).
 *
 * Vercel invokes this every minute via vercel.json crons config.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return fail("Unauthorized", 401);
  }

  try {
    const result = await runDue();
    return ok(result);
  } catch (err) {
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : "Cron runner failed";
    return fail(message, 500);
  }
}
