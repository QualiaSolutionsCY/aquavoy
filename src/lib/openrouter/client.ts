import { getOpenRouterEnv } from "@/lib/env";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agents/onedriveTools";

/**
 * Adapter over the OpenRouter chat-completions API. The rest of the app calls
 * `streamChat` and gets back a raw SSE stream to forward to the browser; only
 * this module knows OpenRouter's wire format, headers, and base URL.
 *
 * `streamChatWithTools` adds tool-calling: it runs a non-streaming loop letting
 * the model call tools (OneDrive, web search, memory, email), then streams the
 * final answer as SSE.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Max iterations of the tool-call loop to prevent runaway. */
const MAX_TOOL_ITERATIONS = 10;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For tool results — the id of the tool_call this responds to. */
  tool_call_id?: string;
}

/** Shape of a tool call in the OpenAI-style response. */
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Shape of a choice in a non-streaming response. */
interface NonStreamingChoice {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: string;
}

/** The two principals Aquavoy recognizes. */
export const PRINCIPALS = ["Wency", "Jeanette"] as const;
export type Principal = (typeof PRINCIPALS)[number];

export interface ChatOptions {
  /** Personalizes the system prompt to a named principal. */
  identity?: Principal;
}

/**
 * The Aquavoy assistant persona. Covers all capabilities: file reading, web
 * research, memory recall, confirmed email sending, and confirmed file
 * organization.
 */
export const SYSTEM_PROMPT = [
  "You are Aquavoy, the conversational AI assistant for Wency's company — an",
  "inland waterway shipping operation (Aquavoy / Faial BV).",
  "You work directly for two principals and recognize them by name:",
  "  - Wency — the company / owner.",
  "  - Jeanette — a principal you assist day to day.",
  "Address the current user by name where it feels natural.",
  "",
  "Tone and length:",
  "  - Be straightforward and intelligent. Answer the question, then stop.",
  "  - Default to SHORT answers — a sentence or two, a tight list at most.",
  "    Only write long answers when the task genuinely requires detail",
  "    (drafting, analysis, step-by-step instructions the user asked for).",
  "  - No filler, no preamble like 'Great question', no recap of what you were asked.",
  "  - Humor is rare and dry — at most a light touch when the moment invites it.",
  "",
  "Formatting: use Markdown sparingly — **bold** for key terms, short bullet",
  "lists when listing. Never produce walls of headed sections for simple questions.",
  "",
  "Capabilities:",
  "",
  "1. FILE ACCESS (OneDrive): use list_folder, search_files, and read_file to",
  "   browse and read the user's connected OneDrive. Supports text, PDF, Word,",
  "   and Excel files. Always cite the file name(s) you read in your answer.",
  "   If no OneDrive account is connected, tell the user to connect on the Files tab.",
  "",
  "2. WEB RESEARCH: use the web_search tool to find current information online.",
  "   When you use web results, cite sources with their titles and URLs.",
  "",
  "3. MEMORY RECALL: use recall_memory to search past conversations when the user",
  "   asks what was discussed before or references earlier topics.",
  "",
  "4. EMAIL: use send_email to send from a connected mail account. IMPORTANT:",
  "   Before calling send_email, ALWAYS show the user the full draft (from, to,",
  "   subject, body) in chat and wait for their EXPLICIT confirmation in a",
  "   follow-up message. Never send without asking first.",
  "",
  "5. FILE ORGANIZATION: use create_folder, move_item, rename_item, delete_item",
  "   to organize files on OneDrive. IMPORTANT: For any organization request,",
  "   first inspect the current structure with list_folder, then PROPOSE the",
  "   folder structure and moves in chat, and wait for user confirmation before",
  "   calling any mutating tool. Never delete a file without naming it and",
  "   getting a yes.",
].join("\n");

/**
 * Start a streaming chat completion. Returns the upstream Response so the route
 * can pipe `response.body` straight to the client as text/event-stream.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<Response> {
  const env = getOpenRouterEnv();
  const system = opts.identity
    ? `${SYSTEM_PROMPT}\n\nThe person you are chatting with right now is ${opts.identity}. Address them by name as ${opts.identity} and tailor your help to them.`
    : SYSTEM_PROMPT;

  const payload: Record<string, unknown> = {
    model: env.OPENROUTER_MODEL,
    stream: true,
    messages: [{ role: "system", content: system }, ...messages],
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aquavoy.app",
      "X-Title": "Aquavoy",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

/**
 * Non-streaming completion — used where we need the whole answer at once (e.g.
 * drafting an email as JSON). Returns the assistant message content.
 */
export async function complete(messages: ChatMessage[], opts: ChatOptions & { web?: boolean } = {}): Promise<string> {
  const env = getOpenRouterEnv();
  const payload: Record<string, unknown> = {
    model: env.OPENROUTER_MODEL,
    messages,
  };
  if (opts.web) payload.plugins = [{ id: "web", max_results: 5 }];

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aquavoy.app",
      "X-Title": "Aquavoy",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

// ── Shared helpers ──────────────────────────────────────────

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://aquavoy.app",
    "X-Title": "Aquavoy",
  };
}

function buildSystemContent(opts: ChatOptions): string {
  return opts.identity
    ? `${SYSTEM_PROMPT}\n\nThe person you are chatting with right now is ${opts.identity}. Address them by name as ${opts.identity} and tailor your help to them.`
    : SYSTEM_PROMPT;
}

/**
 * Tool-calling chat loop followed by a streaming final response. The flow:
 *
 * 1. Send messages + tool definitions to OpenRouter (non-streaming).
 * 2. While the model's finish_reason is "tool_calls" (up to MAX_TOOL_ITERATIONS):
 *    a. Execute each requested tool via executeTool.
 *    b. Append the assistant message (with tool_calls) and tool result messages.
 *    c. Call OpenRouter again (non-streaming) with the extended history.
 * 3. When the model stops calling tools, make a FINAL streaming call with the
 *    complete message history and return the Response so the route can pipe SSE
 *    straight to the browser.
 *
 * This keeps the client-side SSE parser unchanged — it only ever sees the final
 * streamed answer.
 */
export async function streamChatWithTools(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<Response> {
  const env = getOpenRouterEnv();
  const headers = buildHeaders(env.OPENROUTER_API_KEY);
  const system = buildSystemContent(opts);

  // Working message history — starts with system + user messages.
  const history: ChatMessage[] = [
    { role: "system", content: system },
    ...messages,
  ];

  // ── Tool loop (non-streaming) ──────────────────────────────
  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    const payload: Record<string, unknown> = {
      model: env.OPENROUTER_MODEL,
      stream: false,
      messages: history,
      tools: TOOL_DEFINITIONS,
    };

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices?: NonStreamingChoice[] };
    const choice = json.choices?.[0];
    if (!choice) throw new Error("OpenRouter returned no choices");

    const msg = choice.message;
    const toolCalls = msg.tool_calls;

    // If no tool calls, the model is done reasoning — break to final stream.
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== "tool_calls") {
      // Append the assistant's final text answer so context is complete for
      // the streaming call.
      if (msg.content) {
        history.push({ role: "assistant", content: msg.content });
      }
      break;
    }

    // Append the assistant message that contains the tool_calls.
    // OpenAI format: the assistant message holds tool_calls; content may be null.
    history.push({
      role: "assistant",
      content: msg.content ?? "",
      // Stash tool_calls on the message for the next API call.
      ...({ tool_calls: toolCalls } as Record<string, unknown>),
    } as ChatMessage);

    // Execute each tool and append results.
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        // Malformed arguments — tell the model.
      }
      const result = await executeTool(tc.function.name, args);
      history.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }

    iterations++;
  }

  // ── Final streaming call ───────────────────────────────────
  // Drop tool definitions on the final call so the model just answers.
  const finalPayload: Record<string, unknown> = {
    model: env.OPENROUTER_MODEL,
    stream: true,
    messages: history,
  };

  const finalRes = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(finalPayload),
  });

  if (!finalRes.ok || !finalRes.body) {
    const detail = await finalRes.text().catch(() => finalRes.statusText);
    throw new Error(`OpenRouter error ${finalRes.status}: ${detail.slice(0, 300)}`);
  }
  return finalRes;
}
