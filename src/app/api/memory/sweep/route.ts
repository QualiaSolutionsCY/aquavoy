import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";
import { extractFacts } from "@/lib/agents/memoryStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint: extract durable memory facts from CLOSED chat sessions that
 * have not been processed yet (ADR-002 §4 — the "light cron sweep for
 * stragglers" alongside extraction at the New-chat boundary). Protected by a
 * bearer token matching CRON_SECRET (same guard as the mail cron). Vercel
 * invokes this every 5 minutes via vercel.json crons config.
 *
 * "Closed" = any session that is NOT the principal's latest (most recently
 * active) session. Each session is processed at most once: extractFacts upserts
 * on (session_id, fact), so even a re-run is idempotent. Per-session error
 * isolation mirrors the scheduled-mail runDue runner — one failure never aborts
 * the batch.
 */

interface MsgRow {
  principal: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return fail("Unauthorized", 401);
  }

  try {
    const db = supabaseAdmin();

    const { data: rows, error } = await db
      .from("chat_messages")
      .select("principal, session_id, role, content, created_at")
      .order("created_at", { ascending: true })
      // Bound the scan so one cron run can't pull unbounded rows (OOM/scaling guard);
      // 2000 messages comfortably covers recent activity for a small-operator tool.
      .limit(2000);

    if (error) return fail(error.message, 500);
    if (!rows || rows.length === 0) return ok({ processed: 0, failed: 0 });

    const messages = rows as MsgRow[];

    // Group messages by session; track each session's principal and last-active time.
    const sessions = new Map<
      string,
      { principal: string; lastAt: string; msgs: { role: string; content: string }[] }
    >();
    for (const m of messages) {
      const s = sessions.get(m.session_id);
      if (!s) {
        sessions.set(m.session_id, {
          principal: m.principal,
          lastAt: m.created_at,
          msgs: [{ role: m.role, content: m.content }],
        });
      } else {
        s.lastAt = m.created_at;
        s.msgs.push({ role: m.role, content: m.content });
      }
    }

    // The latest (open) session per principal is excluded — only closed threads.
    const latestByPrincipal = new Map<string, string>();
    for (const [sessionId, s] of sessions) {
      const cur = latestByPrincipal.get(s.principal);
      const curAt = cur ? sessions.get(cur)!.lastAt : "";
      if (!cur || s.lastAt > curAt) latestByPrincipal.set(s.principal, sessionId);
    }

    let processed = 0;
    let failed = 0;

    for (const [sessionId, s] of sessions) {
      // Skip the principal's currently-open session.
      if (latestByPrincipal.get(s.principal) === sessionId) continue;

      try {
        // Skip sessions that already have extracted facts (idempotent + cheap).
        const { data: existing } = await db
          .from("memory_facts")
          .select("id")
          .eq("session_id", sessionId)
          .limit(1);
        if (existing && existing.length > 0) continue;

        await extractFacts(s.principal, sessionId, s.msgs);
        processed++;
      } catch {
        failed++;
      }
    }

    return ok({ processed, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory sweep failed";
    return fail(message, 500);
  }
}
