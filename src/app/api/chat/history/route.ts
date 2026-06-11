import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRINCIPALS = ["Wency", "Jeanette"] as const;

const principalParam = z.enum(PRINCIPALS);

const postBody = z.object({
  principal: z.enum(PRINCIPALS),
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .min(1, "content must not be empty")
    .max(32_000, "content exceeds 32 000 characters"),
  sessionId: z.string().uuid("sessionId must be a UUID"),
});

/**
 * GET /api/chat/history?principal=Wency
 * Returns the latest session's messages (ascending) plus its sessionId.
 * Older sessions stay stored and remain searchable via recall_memory —
 * "New chat" just starts writing under a fresh sessionId.
 */
export function GET(req: NextRequest) {
  return handle(async () => {
    const principal = principalParam.safeParse(
      req.nextUrl.searchParams.get("principal"),
    );
    if (!principal.success) return fail("principal must be Wency or Jeanette");

    const db = supabaseAdmin();

    // Latest session = session of the most recent message.
    const { data: latest, error: latestErr } = await db
      .from("chat_messages")
      .select("session_id")
      .eq("principal", principal.data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) return fail(latestErr.message, 500);
    if (!latest) return ok({ sessionId: null, messages: [] });

    const { data, error } = await db
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("principal", principal.data)
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
    const body = postBody.safeParse(await req.json());
    if (!body.success) {
      return fail(
        body.error.issues.map((i) => i.message).join("; "),
      );
    }

    const { principal, role, content, sessionId } = body.data;

    const { error } = await supabaseAdmin()
      .from("chat_messages")
      .insert({ principal, role, content, session_id: sessionId });

    if (error) return fail(error.message, 500);
    return ok({ saved: true });
  });
}

/**
 * DELETE /api/chat/history?principal=Wency
 * Clears all messages for the given principal.
 */
export function DELETE(req: NextRequest) {
  return handle(async () => {
    const principal = principalParam.safeParse(
      req.nextUrl.searchParams.get("principal"),
    );
    if (!principal.success) return fail("principal must be Wency or Jeanette");

    const { error } = await supabaseAdmin()
      .from("chat_messages")
      .delete()
      .eq("principal", principal.data);

    if (error) return fail(error.message, 500);
    return ok({ cleared: true });
  });
}
