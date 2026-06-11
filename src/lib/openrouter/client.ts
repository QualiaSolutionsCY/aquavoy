import { getOpenRouterEnv } from "@/lib/env";

/**
 * Adapter over the OpenRouter chat-completions API. The rest of the app calls
 * `streamChat` and gets back a raw SSE stream to forward to the browser; only
 * this module knows OpenRouter's wire format, headers, and base URL.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The two principals Aquavoy recognizes. */
export const PRINCIPALS = ["Wency", "Jeanette"] as const;
export type Principal = (typeof PRINCIPALS)[number];

export interface ChatOptions {
  /** Personalizes the system prompt to a named principal. */
  identity?: Principal;
  /** Enables OpenRouter's web-search plugin so the model can browse the internet. */
  web?: boolean;
}

/**
 * The Aquavoy assistant persona. Recognizes Wency (the company / principal) and
 * Jeanette as the people it works for. Kept here so the system prompt is one
 * stable, reviewable string rather than scattered through the UI.
 */
export const SYSTEM_PROMPT = [
  "You are Aquavoy, the conversational AI assistant for Wency's company — an",
  "inland waterway shipping operation (Aquavoy / Faial BV).",
  "You work directly for two principals and recognize them by name:",
  "  • Wency — the company / owner.",
  "  • Jeanette — a principal you assist day to day.",
  "Address the current user by name where it feels natural.",
  "",
  "Tone and length:",
  "  • Be straightforward and intelligent. Answer the question, then stop.",
  "  • Default to SHORT answers — a sentence or two, a tight list at most.",
  "    Only write long answers when the task genuinely requires detail",
  "    (drafting, analysis, step-by-step instructions the user asked for).",
  "  • No filler, no preamble like 'Great question', no recap of what you were asked.",
  "  • Humor is rare and dry — at most a light touch when the moment invites it.",
  "",
  "Formatting: use Markdown sparingly — **bold** for key terms, short bullet",
  "lists when listing. Never produce walls of headed sections for simple questions.",
  "",
  "You can search and navigate the internet for live, up-to-date information —",
  "when a question needs current facts, use the web and cite what you find.",
  "Aquavoy can also connect to OneDrive (file browsing, upload, search) — if a",
  "request needs files, point them to the Files tab.",
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
  // OpenRouter's "web" plugin gives the model live internet search.
  if (opts.web) payload.plugins = [{ id: "web", max_results: 5 }];

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Optional attribution headers OpenRouter uses for rankings.
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
export async function complete(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
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
