import { getOpenRouterEnv } from "@/lib/env";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agents/onedriveTools";
import { insertTrace, type ToolCallTrace } from "@/lib/agents/traces";
import * as Sentry from "@sentry/nextjs";

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
  /**
   * The HMAC-verified session principal that owns the persisted trace row.
   * Passed by the route from getPrincipal — NEVER from the request body.
   * Falls back to "unknown" only if the route omits it.
   */
  principal?: string;
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
  "HOW YOU ACT — read this first (most important rule):",
  "  - If a request can be done or answered with one of your tools, CALL THE TOOL.",
  "    Do NOT narrate a plan, do NOT think out loud, do NOT write 'Let me…', 'Let's",
  "    call X', 'Wait, …', 'I'll now…', or a step-by-step of what you are about to",
  "    do. Just call the tool. Your tool calls already appear in a trace — the user",
  "    does not need a play-by-play of your reasoning.",
  "  - NEVER fabricate, guess, or describe what a tool WOULD return in place of",
  "    actually calling it. If you need data, fetch it with the tool first, THEN",
  "    answer from the real result.",
  "  - Read-only requests (inbox briefing, search/read email, list/read OneDrive",
  "    files, finance summary, memory recall, web search) need NO confirmation —",
  "    call the tool immediately on the first turn rather than asking permission or",
  "    explaining your approach.",
  "  - For actions that need a draft or an exact time (send/schedule email, a",
  "    reminder), ask at most ONE short question for the missing detail, then call",
  "    the tool ONCE. Follow each tool's own confirmation rule below — most",
  "    destructive tools are auto-staged by the app for the user to confirm; a",
  "    reminder asks you to agree the time first.",
  "  - Your visible message is the ANSWER (after the tool runs) or a single short",
  "    clarifying question — it is never a monologue of your internal reasoning.",
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
  "NEVER output raw HTML (no <table>, <div>, <td> or any tags) and NEVER use",
  "Markdown tables — the chat renders plain text only and tags show up as broken",
  "markup. When you confirm or relay a staged action, describe it in one short",
  "plain sentence (e.g. \"Staged: email to X, subject Y, sending tomorrow 09:00\"),",
  "not a table.",
  "",
  "Capabilities:",
  "",
  "  When the user asks what you can do, summarize ALL of the below — and ALWAYS",
  "  include INVOICE AUTOMATION: generating Aquavoy invoices from templates,",
  "  recording voyages to the Reis registratie register, and filing email",
  "  attachments (PDF invoices / credit notes) into OneDrive. Do not omit these.",
  "",
  "1. FILE ACCESS (OneDrive): use list_folder, search_files, and read_file to",
  "   browse and read the user's connected OneDrive. Supports text, PDF, Word,",
  "   and Excel files. Always cite the file name(s) you read in your answer.",
  "   If no OneDrive account is connected, tell the user to connect on the Files tab.",
  "   RECENCY: for 'latest/newest/last X' questions, never trust search ranking —",
  "   navigate the folder structure and compare the lastModified dates in the tool",
  "   results. Filenames may not contain the obvious keyword (an invoice can be",
  "   named '26-047 Aquavoy Ltd - Novo Porto...'), so browsing beats searching.",
  "   DRIVE LAYOUT (known): sent invoices live in the 'Verzonden Facturen' folder",
  "   (under alle firma's > Aquavoy Ltd), organized in year subfolders (e.g. 2026).",
  "   For invoice questions, go there first.",
  "",
  "2. WEB RESEARCH: use the web_search tool to find current information online.",
  "   When you use web results, cite sources with their titles and URLs.",
  "",
  "3. MEMORY RECALL: use recall_memory to search past conversations when the user",
  "   asks what was discussed before or references earlier topics.",
  "",
  "4. EMAIL SENDING: use send_email to send from a connected mail account. The",
  "   destructive tools (send_email, schedule_email, delete_item, move_item,",
  "   rename_item, batch_move_to_trash, batch_move_to_folder,",
  "   save_email_attachment) are AUTOMATICALLY",
  "   staged for the user's confirmation by the",
  "   app — they never run immediately. Propose the action with the full draft",
  "   (from, to, subject, body), then call send_email ONCE and relay the `summary`",
  "   it returns; the app shows the user a confirm/cancel card and the user",
  "   approves it in the UI. Do NOT call send_email a second time after the user",
  "   says 'yes' — confirming is the UI's job, not yours.",
  "",
  "5. MAILBOX READ ACCESS: you have full read access to all company mailboxes —",
  "   inbox, sent, drafts, and every other folder — via IMAP. Tools:",
  "   - list_emails: list recent messages in any folder (inbox/sent/drafts/trash).",
  "   - read_email: read the full content of a single message by UID.",
  "   - search_emails: search by text, sender, or date.",
  "   - list_mail_folders: list all folders in a mailbox.",
  "   Reading email is safe and needs NO user confirmation (only sending,",
  "   scheduling, or any mutating action requires confirmation). When summarizing",
  "   emails, always cite the sender, date, and subject line.",
  "",
  "5b. SCHEDULED EMAIL: use schedule_email to queue an email for a future time.",
  "    schedule_email is also staged for confirmation by the app: show the draft",
  "    including the scheduled time, call schedule_email ONCE, and relay the",
  "    summary; the user confirms in the UI. Use list_scheduled_emails to show",
  "    the queue and cancel_scheduled_email to cancel a pending email by id.",
  "",
  "5c. REMINDERS (scheduled tasks): use schedule_task to set a reminder that is",
  "    EMAILED to a connected company mailbox at a future time. Interpret spoken",
  "    times like 'tomorrow 9am' in Europe/Amsterdam and pass scheduledAt as",
  "    ISO-8601 with the correct offset (the time rule below applies).",
  "    REMINDERS CAN REPEAT — schedule_task takes a `recurrence` field",
  "    (none/daily/weekly/monthly). For ANY standing/repeating reminder you MUST",
  "    set it: 'every Monday 7pm email the crew' → scheduledAt the next Monday",
  "    19:00 + recurrence 'weekly'; 'on the 5th of every month …' → the next 5th +",
  "    recurrence 'monthly'; 'every morning at 8' → recurrence 'daily'. ONE",
  "    schedule_task call WITH recurrence sets up the whole repeating series — the",
  "    runner re-arms it after each fire. NEVER tell the user that reminders are",
  "    one-time only, or that you can only set 'the first occurrence' — that is",
  "    FALSE; just set recurrence and the series repeats. Confirm the title AND the",
  "    exact time (and the cadence, when recurring) with the user in chat FIRST.",
  "    Unlike email, scheduling a reminder is benign and runs DIRECTLY — there is",
  "    NO confirmation card; once you call schedule_task the reminder is set, so",
  "    only call it after you have agreed the title and time. Use",
  "    list_scheduled_tasks to show the queue and cancel_scheduled_task to cancel a",
  "    pending reminder by id.",
  "",
  "5d. MAILBOX BATCH MOVES: use batch_move_to_trash to move ALL emails from a",
  "    given sender to Trash, or batch_move_to_folder to move them to another",
  "    folder (e.g. 'trash everything from newsletters@x.com', 'file all mail",
  "    from the accountant into Archive'). Both are staged for confirmation by",
  "    the app: they capture the matched message set and return a `summary` with",
  "    the count and a few sample subjects. Call the tool ONCE, name the sender",
  "    and folder, and relay the summary; the app shows a confirm/cancel card and",
  "    the user approves the move in the UI (the move is reversible — an Undo",
  "    moves the messages back). Do NOT call the tool a second time after the",
  "    user says 'yes' — confirming is the UI's job. If the tool returns",
  "    status 'no_match', tell the user no emails matched — nothing was staged.",
  "",
  "5e. SAVE EMAIL ATTACHMENTS: use save_email_attachment to file an email's",
  "    attachment (e.g. a PDF invoice or credit note) into OneDrive. First call",
  "    read_email to see the message's attachments list, then call",
  "    save_email_attachment ONCE with the mailbox, the message uid, the exact",
  "    attachmentFilename, and the destination (targetFolderId or",
  "    targetFolderPath). Sent invoices live under 'Verzonden Facturen/{year}'",
  "    (alle firma's > Aquavoy Ltd) — pass that path for the matching year.",
  "    It is staged for confirmation by the app (never uploads immediately) and",
  "    is reversible (Undo deletes the uploaded file); relay the returned summary",
  "    and do NOT re-call after the user says yes.",
  "",
  "5f. GENERATE INVOICES: use generate_invoice_from_template to create an Aquavoy",
  "    invoice .docx from a source PDF (credit note or voyage summary). Flow:",
  "    1. Read the source PDF with read_file to get its text.",
  "    2. Extract all invoice fields from the text (company, recipient, vessel,",
  "       invoice_date, invoice_number, line-item amounts, total, currency).",
  "    3. Call generate_invoice_from_template ONCE with all extracted fields.",
  "    It is staged for confirmation by the app (never fills or uploads immediately)",
  "    and is reversible (Undo deletes the generated file). Relay the returned",
  "    summary to the user and do NOT re-call after the user says yes —",
  "    confirming is the UI's job. The company field defaults to Gefo or Novo Porto",
  "    inferred from the source doc; the user can correct it on the confirm card.",
  "",
  "6. FILE ORGANIZATION: use create_folder, move_item, rename_item, delete_item",
  "   to organize files on OneDrive. For any organization request, first inspect",
  "   the current structure with list_folder, then PROPOSE the folder structure",
  "   and moves in chat. move_item, rename_item, and delete_item are staged for",
  "   confirmation by the app — call each ONCE, name the exact file, and relay the",
  "   summary; the user approves the staged action in the UI. create_folder is",
  "   additive and runs directly. Never call a destructive tool twice for one",
  "   request.",
  "",
  "7. SPREADSHEET GENERATION: use create_spreadsheet to build an Excel (.xlsx)",
  "   file from data and save it to OneDrive. First GATHER the data with the",
  "   OneDrive read tools (list_folder, search_files, read_file) — read the source",
  "   files and extract the figures the user asked for — then call",
  "   create_spreadsheet ONCE with the columns and rows (each row aligned to the",
  "   columns by position). Generating a sheet is additive and runs DIRECTLY —",
  "   there is NO confirmation card. The tool returns fileName, webUrl, and",
  "   downloadUrl; relay that link in your reply so the user can open or download",
  "   the file.",
].join("\n");

/**
 * Start a streaming chat completion. Returns the upstream Response so the route
 * can pipe `response.body` straight to the client as text/event-stream.
 */
export async function streamChat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<Response> {
  const provider = chatProvider();
  const system = buildSystemContent(opts);

  const payload: Record<string, unknown> = {
    model: provider.model,
    stream: true,
    messages: [{ role: "system", content: system }, ...messages],
  };
  withFallbacks(provider, payload);

  const res = await fetchStreamWithTimeout(provider.url, {
    method: "POST",
    headers: buildHeaders(provider.key),
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
  const provider = chatProvider();
  const payload: Record<string, unknown> = {
    model: provider.model,
    messages,
  };
  // The web plugin is OpenRouter-specific; skip it on direct Gemini.
  if (opts.web && provider.openrouter) payload.plugins = [{ id: "web", max_results: 5 }];
  withFallbacks(provider, payload);

  const res = await fetchWithTimeout(provider.url, {
    method: "POST",
    headers: buildHeaders(provider.key),
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

/** Non-streaming request timeout: a hung upstream must not pin the function. */
const FETCH_TIMEOUT_MS = 30_000;
/**
 * Streaming header timeout. We only abort if the upstream never sends RESPONSE
 * HEADERS — once fetch resolves (headers received) we clear the timer, so a long
 * SSE body is never cut. Use a generous ceiling for slow tool-laden first byte.
 */
const STREAM_HEADER_TIMEOUT_MS = 120_000;

/**
 * fetch with a hard abort after FETCH_TIMEOUT_MS. For NON-streaming calls only,
 * where we read the whole body — aborting kills the request and any in-flight body.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * fetch for STREAMING calls. The timeout guards only the time-to-headers; once
 * the response object (headers) arrives, the timer is cleared so the SSE body
 * can stream for as long as the model keeps producing tokens. This protects
 * against a hung upstream that never responds, without truncating long replies.
 */
async function fetchStreamWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), STREAM_HEADER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Headers received — stop the clock so the body stream runs unbounded.
    clearTimeout(t);
    return res;
  } catch (err) {
    clearTimeout(t);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `OpenRouter stream did not respond within ${STREAM_HEADER_TIMEOUT_MS / 1000}s`,
      );
    }
    throw err;
  }
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://aquavoy.app",
    "X-Title": "Aquavoy",
  };
}

const GOOGLE_OPENAI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

interface ChatProvider {
  url: string;
  key: string;
  model: string;
  /** True when talking to OpenRouter — enables models-fallback + plugins. */
  openrouter: boolean;
}

/**
 * Resolve the chat provider. Direct Gemini (Google's OpenAI-compatible endpoint)
 * is used ONLY when a chat model is explicitly configured via GEMINI_MODEL —
 * never merely because GOOGLE_API_KEY is present. GOOGLE_API_KEY is also required
 * by the embeddings layer (memory recall/sweep), so keying chat routing off its
 * mere presence would silently hijack the whole chat pipeline onto direct Gemini
 * the moment embeddings are enabled. Default chat stays on OpenRouter
 * (OPENROUTER_MODEL, e.g. "nvidia/nemotron-3-super-120b-a12b:free"); set GEMINI_MODEL to a valid
 * Google model id to opt into direct Gemini. The endpoint is OpenAI-wire-
 * compatible either way, so the tool loop works unchanged.
 */
function chatProvider(): ChatProvider {
  const google = process.env.GOOGLE_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL;
  if (google && geminiModel) {
    return {
      url: GOOGLE_OPENAI_URL,
      key: google,
      model: geminiModel,
      openrouter: false,
    };
  }
  const env = getOpenRouterEnv();
  return {
    url: OPENROUTER_URL,
    key: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    openrouter: true,
  };
}

/**
 * OpenRouter auto-fallback: when OPENROUTER_FALLBACK_MODELS (comma-separated)
 * is set, send a `models` list — the first non-rate-limited model serves.
 */
function withFallbacks(p: ChatProvider, payload: Record<string, unknown>): void {
  if (!p.openrouter) return;
  const extra = (process.env.OPENROUTER_FALLBACK_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.length) payload.models = [p.model, ...extra];
}

function buildSystemContent(opts: ChatOptions): string {
  const timeContext = `\n\nCurrent date/time: ${new Date().toISOString()} (UTC). The user's timezone is Europe/Amsterdam — interpret spoken times like "tomorrow 9:00" in Europe/Amsterdam and pass sendAt as ISO-8601 with the correct offset.`;
  const base = SYSTEM_PROMPT + timeContext;
  return opts.identity
    ? `${base}\n\nThe person you are chatting with right now is ${opts.identity}. Address them by name as ${opts.identity} and tailor your help to them.`
    : base;
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
  const provider = chatProvider();
  const headers = buildHeaders(provider.key);
  const system = buildSystemContent(opts);

  // ── Trace instrumentation (REQ-12/13/14) ──────────────────
  // Capture model/provider/per-tool latency/token usage for this whole turn.
  // The trace row is owned by the HMAC-verified session principal (opts.principal),
  // never a value the model supplied.
  const turnStart = Date.now();
  const providerName: "openrouter" | "gemini" = provider.openrouter ? "openrouter" : "gemini";
  const tracePrincipal = opts.principal ?? "unknown";
  const toolTraces: ToolCallTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  // The model's direct answer captured in the (non-streaming) tool loop. Kept as
  // a safety net: if the final streaming call returns an empty completion, we
  // emit this so the user never sees "(no response)".
  let fallbackAnswer = "";

  try {
    // Working message history — starts with system + user messages.
    const history: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    // ── Tool loop (non-streaming) ────────────────────────────
    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      const payload: Record<string, unknown> = {
        model: provider.model,
        stream: false,
        messages: history,
        tools: TOOL_DEFINITIONS,
      };
      withFallbacks(provider, payload);

      const res = await fetchWithTimeout(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        throw new Error(`OpenRouter error ${res.status}: ${detail.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        choices?: NonStreamingChoice[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      promptTokens += json.usage?.prompt_tokens ?? 0;
      completionTokens += json.usage?.completion_tokens ?? 0;

      const choice = json.choices?.[0];
      if (!choice) throw new Error("OpenRouter returned no choices");

      const msg = choice.message;
      const toolCalls = msg.tool_calls;

      // If no tool calls, the model is done reasoning — break to the final
      // streaming call below, which regenerates the answer as SSE.
      //
      // IMPORTANT: do NOT append msg.content to history here. Appending it makes
      // the final streaming call see a conversation that already ends with the
      // assistant's answer, so the model streams an EMPTY completion — the
      // "(no response)" bug. With nothing appended, history ends at the user
      // message (direct answer) or the tool results (after tool use), so the
      // streaming call always has something to generate. We keep the text as a
      // fallback in case the streaming call still comes back empty.
      if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== "tool_calls") {
        fallbackAnswer = msg.content ?? "";
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
        // Identity for principal-scoped tools (e.g. recall_memory) is taken from
        // the HMAC-verified session, NEVER from the model's tool-call arguments —
        // otherwise the model could be steered to read another principal's data.
        const tStart = Date.now();
        // executeTool is contracted to never throw, but a thrown error here (a
        // bug, an unexpected rejection type) must not 502 the whole turn — feed
        // the model an {error} tool-result so it can recover and continue.
        let result: string;
        try {
          result = await executeTool(tc.function.name, args, null, opts.identity);
        } catch (err) {
          result = JSON.stringify({
            error: `Tool ${tc.function.name} failed: ${err instanceof Error ? err.message : "unknown"}`,
          });
        }
        const latencyMs = Date.now() - tStart;

        toolTraces.push(summarizeToolCall(tc.function.name, args, result, latencyMs));

        history.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }

      iterations++;
    }

    // If the tool budget was exhausted (the model kept calling tools and never
    // produced a final answer), nudge it to answer from what it already gathered.
    // Without this, the final streaming call can come back empty and the user sees
    // "(no response)" even though the tools returned useful data (e.g. it read a
    // spreadsheet + a couple of unreadable PDFs but never summarised them).
    if (!fallbackAnswer && toolTraces.length > 0) {
      // Weak models (e.g. gemini-flash) choke on the long multi-round tool-call
      // history and return an EMPTY final answer — the user saw "(no response)".
      // Re-ask with a CLEAN prompt: just the question + a digest of what the tools
      // returned. A short, clean prompt is far more reliable than re-feeding the
      // raw history, and the result is kept as the fallback the stream wrapper
      // injects if the streaming call below produces nothing. Guarantees a real
      // reply on any model.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const digest = toolTraces.map((t) => `- ${t.name}: ${t.resultSummary}`).join("\n");
      fallbackAnswer = await complete(
        [
          {
            role: "system",
            content:
              "Answer the user's question using ONLY the tool results below. Be direct and concise. If the answer is not present, say so plainly in a sentence or two and suggest a concrete next step. Do not mention tools or these instructions.",
          },
          {
            role: "user",
            content: `Question: ${lastUser?.content ?? ""}\n\nTool results:\n${digest}`,
          },
        ],
        opts,
      ).catch(() => "");
    }

    // ── Final streaming call ─────────────────────────────────
    // Drop tool definitions on the final call so the model just answers.
    // include_usage makes the terminal SSE chunk carry token counts.
    const finalPayload: Record<string, unknown> = {
      model: provider.model,
      stream: true,
      messages: history,
      stream_options: { include_usage: true },
    };
    withFallbacks(provider, finalPayload);

    const finalRes = await fetchStreamWithTimeout(provider.url, {
      method: "POST",
      headers,
      body: JSON.stringify(finalPayload),
    });

    if (!finalRes.ok || !finalRes.body) {
      const detail = await finalRes.text().catch(() => finalRes.statusText);
      throw new Error(`OpenRouter error ${finalRes.status}: ${detail.slice(0, 300)}`);
    }

    // Wrap the upstream SSE body: pass every chunk through byte-for-byte, sniff
    // `data:` lines for terminal usage, and — just before forwarding upstream
    // `data: [DONE]` — persist the trace and emit one trailing trace-id line.
    const wrapped = wrapStreamWithTrace(finalRes.body, {
      principal: tracePrincipal,
      model: provider.model,
      provider: providerName,
      toolTraces,
      turnStart,
      basePromptTokens: promptTokens,
      baseCompletionTokens: completionTokens,
      fallbackAnswer,
    });

    return new Response(wrapped, {
      status: finalRes.status,
      headers: finalRes.headers,
    });
  } catch (err) {
    // Criterion 3: even when the loop throws mid-turn (e.g. upstream 502), still
    // persist a trace with the thrown message + whatever tool calls completed,
    // then re-throw so route.ts keeps its 502 behavior.
    // Caught here, so onRequestError won't see it — report the failed turn.
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : "Chat turn failed";
    await insertTrace({
      principal: tracePrincipal,
      model: provider.model,
      provider: providerName,
      toolCalls: toolTraces,
      latencyMs: Date.now() - turnStart,
      promptTokens,
      completionTokens,
      error: message,
    }).catch((traceErr) => {
      // Trace persistence must never mask the original upstream error — but log
      // it (visible in Vercel logs) so a failing trace insert isn't fully silent.
      console.error("[aquavoy] trace persistence failed (error path):", traceErr);
      Sentry.captureException(traceErr);
    });
    throw err;
  }
}

/** Compact one-line JSON of args, capped ~200 chars. */
function compactArgs(args: Record<string, unknown>): string {
  let s: string;
  try {
    s = JSON.stringify(args);
  } catch {
    s = "{}";
  }
  return s.length > 200 ? s.slice(0, 200) : s;
}

/**
 * Build a ToolCallTrace from an executeTool result. executeTool returns a JSON
 * string; error tools return `{"error": "..."}`. When that shape is present we
 * populate `error` and reflect the failure in `resultSummary`.
 */
function summarizeToolCall(
  name: string,
  args: Record<string, unknown>,
  result: string,
  latencyMs: number,
): ToolCallTrace {
  let error: string | null = null;
  try {
    const parsed = JSON.parse(result) as { error?: unknown };
    if (typeof parsed.error === "string") error = parsed.error;
  } catch {
    // Non-JSON result (e.g. the no-connection plain-text message) — no error field.
  }
  const resultSummary = result.length > 200 ? result.slice(0, 200) : result;
  return {
    name,
    argsSummary: compactArgs(args),
    resultSummary,
    latencyMs,
    error,
  };
}

interface StreamTraceContext {
  principal: string;
  model: string;
  provider: "openrouter" | "gemini";
  toolTraces: ToolCallTrace[];
  turnStart: number;
  basePromptTokens: number;
  baseCompletionTokens: number;
  /** Direct answer from the tool loop, emitted only if the stream has no content. */
  fallbackAnswer: string;
}

/**
 * Wrap an upstream OpenRouter SSE body so the bytes reach the browser unchanged,
 * while we (a) sniff the terminal `usage` chunk for token counts, and (b) just
 * before forwarding `data: [DONE]`, persist the turn's trace and emit one extra
 * `data: {"aquavoy_trace_id":"<id>"}` line. Line-buffering preserves multibyte
 * chunk boundaries; the original [DONE] is always forwarded.
 */
function wrapStreamWithTrace(
  body: ReadableStream<Uint8Array>,
  ctx: StreamTraceContext,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  // Line buffer used ONLY for sniffing token usage out of the text stream.
  // Forwarded bytes are never reconstructed from this — raw chunks pass through
  // untouched so the deltas remain byte-for-byte identical to OpenRouter's.
  let sniffBuffer = "";
  let promptTokens = ctx.basePromptTokens;
  let completionTokens = ctx.baseCompletionTokens;
  let tracePersisted = false;
  // Whether the upstream stream carried ANY assistant text. If it stays false,
  // the model returned an empty completion and we emit ctx.fallbackAnswer so the
  // user never sees "(no response)".
  let sawContent = false;

  /** Pull `usage` (and detect content) off a complete SSE data line if present. */
  const sniffUsage = (line: string): void => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const obj = JSON.parse(payload) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
      };
      if (obj.usage) {
        if (typeof obj.usage.prompt_tokens === "number") promptTokens = obj.usage.prompt_tokens;
        if (typeof obj.usage.completion_tokens === "number")
          completionTokens = obj.usage.completion_tokens;
      }
      const piece = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content;
      if (typeof piece === "string" && piece.length > 0) sawContent = true;
    } catch {
      // Not JSON (or a partial line not yet complete) — ignore.
    }
  };

  /** SSE bytes that inject the fallback answer as one content delta. */
  const fallbackDeltaBytes = (): Uint8Array =>
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content: ctx.fallbackAnswer } }] })}\n\n`,
    );
  /** Emit the fallback answer once, if the stream produced no content. */
  const maybeEmitFallback = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!sawContent && ctx.fallbackAnswer) {
      controller.enqueue(fallbackDeltaBytes());
      sawContent = true;
    }
  };

  /** Decode a chunk into complete lines for sniffing, keeping the partial tail. */
  const sniffChunk = (chunk: Uint8Array): void => {
    sniffBuffer += decoder.decode(chunk, { stream: true });
    const lines = sniffBuffer.split("\n");
    sniffBuffer = lines.pop() ?? "";
    for (const line of lines) sniffUsage(line);
  };

  const persistTrace = async (): Promise<string> => {
    if (tracePersisted) return "";
    tracePersisted = true;
    try {
      return await insertTrace({
        principal: ctx.principal,
        model: ctx.model,
        provider: ctx.provider,
        toolCalls: ctx.toolTraces,
        latencyMs: Date.now() - ctx.turnStart,
        promptTokens,
        completionTokens,
        error: null,
      });
    } catch (traceErr) {
      // Persistence failure must not break the stream the user is reading, but
      // log it (Vercel logs) so the lost audit row isn't fully silent.
      console.error("[aquavoy] trace persistence failed (stream path):", traceErr);
      Sentry.captureException(traceErr);
      return "";
    }
  };

  // Marker bytes for the terminal SSE event. OpenRouter emits `data: [DONE]`.
  const DONE_MARKER = encoder.encode("data: [DONE]");

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        // Stream ended without us having seen an explicit [DONE] chunk — if the
        // model produced no content, inject the fallback answer first, then emit
        // the trace-id line (still before close) so it is never omitted.
        maybeEmitFallback(controller);
        const id = await persistTrace();
        if (id) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ aquavoy_trace_id: id })}\n\n`),
          );
        }
        controller.close();
        return;
      }

      // Sniff token usage from this chunk's complete lines.
      sniffChunk(value);

      // Locate `data: [DONE]` at an SSE line boundary inside the raw bytes. If
      // present, split the chunk so the trace-id line lands BEFORE the terminal
      // marker, byte-for-byte. A match mid-line (e.g. the literal `data: [DONE]`
      // appearing inside a JSON string value) is ignored.
      const idx = indexOfBytes(value, DONE_MARKER);
      if (idx < 0) {
        controller.enqueue(value);
        return;
      }

      // Forward everything up to (not including) the [DONE] marker untouched.
      if (idx > 0) controller.enqueue(value.subarray(0, idx));

      // If the model streamed no content, inject the fallback answer before the
      // terminal marker so the user never sees an empty reply.
      maybeEmitFallback(controller);

      // Persist + announce the trace before the [DONE] bytes.
      const id = await persistTrace();
      if (id) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ aquavoy_trace_id: id })}\n\n`),
        );
      }

      // Forward the [DONE] marker and any trailing bytes untouched.
      controller.enqueue(value.subarray(idx));
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

/**
 * Index of the first occurrence of `needle` in `haystack` that begins at an SSE
 * line boundary, or -1. A line boundary is byte offset 0 of the haystack, or any
 * offset immediately following a `\n` (0x0A) byte. SSE markers are only valid at
 * the start of a line, so a needle appearing mid-line (e.g. the literal
 * `data: [DONE]` inside a JSON string value) is skipped, not matched.
 */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    // Full-needle match at offset i — accept only at a true line boundary.
    if (i === 0 || haystack[i - 1] === 0x0A) return i;
  }
  return -1;
}
