import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { runDueTasks } from "@/lib/agents/scheduledTasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint: deliver all due reminders by email. Protected by a bearer token
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
    const result = await runDueTasks();
    return ok(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cron runner failed";
    return fail(message, 500);
  }
}
