import { NextRequest, NextResponse } from "next/server";
import { PRINCIPALS, streamChatWithTools, type ChatMessage, type Principal } from "@/lib/openrouter/client";
import { autoRecall } from "@/lib/agents/memoryTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = new Set(["user", "assistant", "system"]);
const PRINCIPAL_SET = new Set<string>(PRINCIPALS);

/**
 * POST /api/chat  { messages: ChatMessage[], identity?: "Wency"|"Jeanette" }
 * Streams the model's reply back as Server-Sent Events (OpenRouter's native
 * SSE format), which the client parses incrementally.
 */
export async function POST(req: NextRequest) {
  let messages: ChatMessage[];
  let identity: Principal | undefined;
  try {
    const body = (await req.json()) as {
      messages?: ChatMessage[];
      identity?: string;
    };
    messages = (body.messages ?? []).filter(
      (m) => m && ROLES.has(m.role) && typeof m.content === "string",
    );
    // Whitelist the identity — never trust it raw into the prompt.
    identity =
      typeof body.identity === "string" && PRINCIPAL_SET.has(body.identity)
        ? (body.identity as Principal)
        : undefined;
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

    const upstream = await streamChatWithTools(messages, { identity });
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
