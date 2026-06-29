import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { runInboxScan } from "@/lib/mail/inboxScan";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint: scan inbox for new incoming mail. Protected by a bearer token
 * matching CRON_SECRET (set in .env.local and Vercel env vars).
 *
 * Vercel invokes this every 6 hours via vercel.json crons config.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return fail("Unauthorized", 401);
  }

  try {
    return ok(await runInboxScan());
  } catch (err) {
    Sentry.captureException(err);
    return fail(err instanceof Error ? err.message : "Inbox scan failed", 500);
  }
}
