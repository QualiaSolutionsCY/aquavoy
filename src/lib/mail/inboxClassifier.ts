import { complete, type ChatMessage, type ChatOptions } from "@/lib/openrouter/client";

/**
 * Per-message inbox classifier. Given the From/Subject/Body of a single email,
 * asks the LLM to return EXACTLY one of six category labels. Separate from
 * briefing.ts which does whole-inbox triage — this is a single-label classifier
 * for the automated inbox scan (REQ-29).
 *
 * Defensive at every step: a malformed model reply degrades to "routine" (the
 * safe non-financial default) rather than throwing, so a classification failure
 * never aborts the cron batch.
 */

/** Per-field length cap for From and Subject — bounds prompt token cost. */
const FIELD_CAP = 200;
/** Body length cap — longer bodies are clipped to keep the prompt bounded. */
const BODY_CAP = 2000;

/** The six mutually-exclusive categories for a single inbox message. */
export type InboxCategory =
  | "invoice"
  | "creditNote"
  | "voyageSummary"
  | "important"
  | "routine"
  | "spam";

/** The six category literals as a Set for O(1) membership checks. */
const VALID_CATEGORIES = new Set<string>([
  "invoice",
  "creditNote",
  "voyageSummary",
  "important",
  "routine",
  "spam",
]);

export interface ClassifyInput {
  from: string;
  subject: string;
  body: string;
}

/** Clip a From/Subject field to FIELD_CAP chars. */
function clipField(value: string): string {
  return value.length > FIELD_CAP ? value.slice(0, FIELD_CAP) : value;
}

/** Clip the body to BODY_CAP chars. */
function clipBody(value: string): string {
  return value.length > BODY_CAP ? value.slice(0, BODY_CAP) : value;
}

const SYSTEM_INSTRUCTION = [
  "You are an email classifier for an inland waterway shipping company (Aquavoy / Faial BV).",
  "Given one email (From, Subject, Body), classify it into EXACTLY one of these six categories:",
  "",
  "  invoice        — a supplier invoice or sales invoice document sent to or from the company.",
  "  creditNote     — a credit note, often referencing a voyage number or a Gefo/Novo Porto reference.",
  "  voyageSummary  — voyage details or a voyage summary from the operations mailbox.",
  "  important      — a real message the user needs to read or act on (not financial).",
  "  routine        — real but low-priority (receipts, notifications, automated confirmations).",
  "  spam           — unsolicited advertising, marketing blasts, cold sales, phishing, newsletters.",
  "",
  "Return STRICT JSON ONLY — no prose, no Markdown, no code fences. Exact shape:",
  '{ "category": "<one of the six category names>" }',
  "",
  "Rules: return EXACTLY one category name spelled exactly as shown above. No other text.",
].join("\n");

/**
 * Classify a single email into one of the six InboxCategory literals. Calls the
 * LLM non-streaming via complete(), parses the JSON response defensively, and
 * returns "routine" on any parse failure or unrecognized value.
 *
 * @param input  the email envelope + body to classify
 * @param opts   ChatOptions forwarded to complete() (identity, principal, etc.)
 */
export async function classifyMessage(
  input: ClassifyInput,
  opts: ChatOptions = {},
): Promise<InboxCategory> {
  const userContent = [
    `From: ${clipField(input.from)}`,
    `Subject: ${clipField(input.subject)}`,
    `Body:\n${clipBody(input.body)}`,
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    { role: "user", content: userContent },
  ];

  const reply = await complete(messages, opts);

  // Defensive parse: strip a ```json … ``` fence if present (mirroring briefing.ts:108).
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : reply).trim();
  if (!candidate) return "routine";

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return "routine";
  }

  if (!parsed || typeof parsed !== "object") return "routine";
  const category = (parsed as Record<string, unknown>).category;
  if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) return "routine";

  return category as InboxCategory;
}
