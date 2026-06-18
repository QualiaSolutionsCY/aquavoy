import { NextRequest, NextResponse } from "next/server";
import { streamChatWithTools, type ChatMessage } from "@/lib/openrouter/client";
import { autoRecall } from "@/lib/agents/memoryTools";
import { getPrincipal } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* The agent tool-loop (up to MAX_TOOL_ITERATIONS OneDrive/web calls) runs BEFORE
   the first streamed byte. Tool-heavy turns — e.g. the Finance "scan & propose"
   organization request — exceed Vercel's short default function timeout, so the
   streamed reply never starts and the page shows no response. Match the 120s
   stream-header window in lib/openrouter/client.ts with headroom. */
export const maxDuration = 300;

const ROLES = new Set(["user", "assistant", "system"]);

/**
 * POST /api/chat  { messages: ChatMessage[] }
 * Streams the model's reply back as Server-Sent Events (OpenRouter's native
 * SSE format), which the client parses incrementally. The acting principal is
 * derived from the verified session cookie (ADR-001) — never from the body.
 */
export async function POST(req: NextRequest) {
  // Identity comes from the verified session, not the request body.
  const identity = getPrincipal(req) ?? undefined;
  if (!identity) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as {
      messages?: ChatMessage[];
    };
    messages = (body.messages ?? []).filter(
      (m) => m && ROLES.has(m.role) && typeof m.content === "string",
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ ok: false, error: "messages is required" }, { status: 400 });
  }

  try {
    // Automatic memory: surface relevant past-conversation snippets so the
    // model never has to "remember to remember". Soft-fails silently.
    if (identity) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        const memo = await autoRecall(identity, lastUser.content).catch(() => null);
        if (memo) messages = [{ role: "system", content: memo }, ...messages];
      }
    }

    const upstream = await streamChatWithTools(messages, { identity, principal: identity });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
