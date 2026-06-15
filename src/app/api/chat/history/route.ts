import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getPrincipal } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postBody = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1, "content must not be empty")
    .max(32_000, "content exceeds 32 000 characters"),
  sessionId: z.string().uuid("sessionId must be a UUID"),
});

/**
 * The acting principal is derived from the verified session cookie (ADR-001 +
 * REQ-3) — never from a query param or body. One operator cannot read or write
 * another's history.
 *
 * GET /api/chat/history
 *   Default mode — returns the latest session's messages (ascending) plus its sessionId.
 *
 * GET /api/chat/history?view=sessions
 *   Session-list mode — returns up to 30 distinct sessions (most-recent first),
 *   each with { sessionId, startedAt, lastAt, count, title }.
 *
 * GET /api/chat/history?sessionId=<uuid>
 *   Single-session mode — returns that session's messages ascending.
 */
export function GET(req: NextRequest) {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);

    const view = req.nextUrl.searchParams.get("view");
    const sessionIdParam = req.nextUrl.searchParams.get("sessionId");

    const db = supabaseAdmin();

    // ── Mode: session list ──
    if (view === "sessions") {
      // Fetch all messages for aggregation in TypeScript (row counts are small).
      const { data: rows, error: rowsErr } = await db
        .from("chat_messages")
        .select("session_id, role, content, created_at")
        .eq("principal", principal)
        .order("created_at", { ascending: true });

      if (rowsErr) return fail(rowsErr.message, 500);

      // Group by session_id, aggregate per-session stats.
      const map = new Map<
        string,
        { startedAt: string; lastAt: string; count: number; title: string }
      >();

      for (const r of rows ?? []) {
        const sid = r.session_id as string;
        const existing = map.get(sid);
        if (!existing) {
          // First row for this session — derive title.
          const raw = (r.content as string) ?? "";
          const title =
            r.role === "user"
              ? raw.trim().slice(0, 60) || "(empty thread)"
              : raw.trim().slice(0, 60) || "(empty thread)";
          map.set(sid, {
            startedAt: r.created_at as string,
            lastAt: r.created_at as string,
            count: 1,
            title,
          });
        } else {
          existing.lastAt = r.created_at as string;
          existing.count++;
          // Prefer the first user message as the title (overwrite only once).
          if (
            r.role === "user" &&
            existing.count <= 10 &&
            existing.title === ((rows ?? []).find((x) => x.session_id === sid)?.content as string)?.trim().slice(0, 60)
          ) {
            // Title is already the first message; only overwrite if it was from assistant.
          }
        }
      }

      // Second pass: ensure title prefers first user message.
      // Since rows are ordered ascending, walk again per session.
      const titleOverrides = new Map<string, string>();
      for (const r of rows ?? []) {
        const sid = r.session_id as string;
        if (titleOverrides.has(sid)) continue;
        if (r.role === "user") {
          const raw = (r.content as string)?.trim().slice(0, 60);
          if (raw) titleOverrides.set(sid, raw);
        }
      }
      for (const [sid, title] of titleOverrides) {
        const entry = map.get(sid);
        if (entry) entry.title = title;
      }

      // Sort by lastAt descending, cap at 30.
      const sessions = Array.from(map.entries())
        .map(([sessionId, s]) => ({ sessionId, ...s }))
        .sort((a, b) => (b.lastAt > a.lastAt ? 1 : b.lastAt < a.lastAt ? -1 : 0))
        .slice(0, 30);

      return ok({ sessions });
    }

    // ── Mode: single session by ID ──
    if (sessionIdParam) {
      const parsed = z.string().uuid().safeParse(sessionIdParam);
      if (!parsed.success) return fail("sessionId must be a valid UUID");

      const { data, error } = await db
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("principal", principal)
        .eq("session_id", parsed.data)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) return fail(error.message, 500);

      return ok({
        sessionId: parsed.data,
        messages: (data ?? []).map((r) => ({
          role: r.role,
          content: r.content,
          createdAt: r.created_at,
        })),
      });
    }

    // ── Default mode: latest session (original behavior) ──
    // Latest session = session of the most recent message.
    const { data: latest, error: latestErr } = await db
      .from("chat_messages")
      .select("session_id")
      .eq("principal", principal)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) return fail(latestErr.message, 500);
    if (!latest) return ok({ sessionId: null, messages: [] });

    const { data, error } = await db
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("principal", principal)
      .eq("session_id", latest.session_id)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) return fail(error.message, 500);

    return ok({
      sessionId: latest.session_id as string,
      messages: (data ?? []).map((r) => ({
        role: r.role,
        content: r.content,
        createdAt: r.created_at,
      })),
    });
  });
}

/**
 * POST /api/chat/history
 * Persists a single message for a principal.
 */
export function POST(req: NextRequest) {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);

    const body = postBody.safeParse(await req.json());
    if (!body.success) {
      return fail(
        body.error.issues.map((i) => i.message).join("; "),
      );
    }

    const { role, content, sessionId } = body.data;

    const { error } = await supabaseAdmin()
      .from("chat_messages")
      .insert({ principal, role, content, session_id: sessionId });

    if (error) return fail(error.message, 500);
    return ok({ saved: true });
  });
}

/**
 * DELETE /api/chat/history
 * Clears all messages for the session's principal.
 */
export function DELETE(req: NextRequest) {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);

    const { error } = await supabaseAdmin()
      .from("chat_messages")
      .delete()
      .eq("principal", principal);

    if (error) return fail(error.message, 500);
    return ok({ cleared: true });
  });
}
