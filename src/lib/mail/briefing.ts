import { listEmails, type EmailSummary } from "./imap";
import { complete, type ChatMessage, type ChatOptions } from "@/lib/openrouter/client";

/**
 * On-demand inbox briefing generator. Fetches the most recent inbox messages
 * (read-only, via the IMAP adapter), asks the LLM to triage each one as
 * important / routine / spam-or-ads, and returns a small typed structure the
 * agent can read back to the user — "what to read, what to skip".
 *
 * No IO besides listEmails + the single LLM call. The LLM classification is
 * defensive: a malformed model response degrades to a safe, empty structure
 * rather than throwing, so a briefing request never 500s the turn.
 */

/** Newest N messages to triage. Kept small — the model reads every envelope. */
const DEFAULT_LIMIT = 20;
/** Hard ceiling so a huge `limit` can't blow up the prompt. */
const MAX_LIMIT = 25;
/** Per-field length cap fed into the prompt, to bound token cost. */
const FIELD_CAP = 200;

export interface BriefingImportant {
  from: string;
  subject: string;
  /** One short sentence on why this matters / needs reading. */
  reason: string;
}

export interface BriefingSpam {
  from: string;
  subject: string;
}

export interface InboxBriefing {
  mailbox: string;
  /** How many messages were triaged. */
  total: number;
  important: BriefingImportant[];
  likelySpam: BriefingSpam[];
  /** 1-2 sentence plain-text overview of the inbox. */
  summary: string;
}

export interface BriefingOptions extends ChatOptions {
  /** Folder to brief (defaults to inbox). */
  folder?: string;
  /** How many recent messages to triage (default 20, max 25). */
  limit?: number;
}

/** Clip a field to FIELD_CAP chars so one long subject can't bloat the prompt. */
function clip(value: string): string {
  return value.length > FIELD_CAP ? value.slice(0, FIELD_CAP) : value;
}

/**
 * The LLM speaks back STRICT JSON. This shape mirrors what we ask for; every
 * field is optional/loose here because we parse a model response we don't trust.
 */
interface RawBriefing {
  summary?: unknown;
  important?: unknown;
  likelySpam?: unknown;
}

/** Coerce one model-supplied "important" entry into our strict shape, or null. */
function coerceImportant(raw: unknown): BriefingImportant | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const from = typeof r.from === "string" ? r.from : "";
  const subject = typeof r.subject === "string" ? r.subject : "";
  const reason = typeof r.reason === "string" ? r.reason : "";
  if (!from && !subject) return null;
  return { from, subject, reason };
}

/** Coerce one model-supplied "spam" entry into our strict shape, or null. */
function coerceSpam(raw: unknown): BriefingSpam | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const from = typeof r.from === "string" ? r.from : "";
  const subject = typeof r.subject === "string" ? r.subject : "";
  if (!from && !subject) return null;
  return { from, subject };
}

/**
 * Parse the model's reply into the classified arrays + summary. Defensive at
 * every step: strips a ```json fence if present, tolerates a missing or
 * malformed shape, and returns empty arrays + a fallback summary rather than
 * throwing. The caller always gets a well-formed object.
 */
function parseBriefing(reply: string, total: number): {
  important: BriefingImportant[];
  likelySpam: BriefingSpam[];
  summary: string;
} {
  const fallback = {
    important: [] as BriefingImportant[],
    likelySpam: [] as BriefingSpam[],
    summary:
      total === 0
        ? "The mailbox has no recent messages to brief."
        : `Briefed ${total} recent message${total === 1 ? "" : "s"}, but the automatic classification was unavailable — review them directly.`,
  };

  // The model is asked for bare JSON, but be tolerant of a ```json … ``` fence.
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced ? fenced[1] : reply).trim();
  if (!candidate) return fallback;

  let parsed: RawBriefing;
  try {
    parsed = JSON.parse(candidate) as RawBriefing;
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== "object") return fallback;

  const important = Array.isArray(parsed.important)
    ? parsed.important.map(coerceImportant).filter((x): x is BriefingImportant => x !== null)
    : [];
  const likelySpam = Array.isArray(parsed.likelySpam)
    ? parsed.likelySpam.map(coerceSpam).filter((x): x is BriefingSpam => x !== null)
    : [];
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallback.summary;

  return { important, likelySpam, summary };
}

/** Build the user message: a compact, numbered list of envelopes to triage. */
function buildEmailList(emails: EmailSummary[]): string {
  return emails
    .map((e, i) => {
      const date = e.date ?? "(no date)";
      const unread = e.seen === false ? " [UNREAD]" : "";
      return `${i + 1}. From: ${clip(e.from)} | Subject: ${clip(e.subject)} | Date: ${date}${unread}`;
    })
    .join("\n");
}

const SYSTEM_INSTRUCTION = [
  "You are an inbox triage assistant. Given a numbered list of recent emails",
  "(sender, subject, date), classify each as one of: important (a real message",
  "the user needs to read or act on), routine (real but low-priority — receipts,",
  "notifications, automated confirmations), or spam (unsolicited advertising,",
  "marketing blasts, cold sales, phishing, newsletters the user did not ask for).",
  "",
  "Return STRICT JSON ONLY — no prose, no Markdown, no code fences. Exact shape:",
  '{',
  '  "summary": "<1-2 sentence plain-text overview of the inbox>",',
  '  "important": [{ "from": "<sender>", "subject": "<subject>", "reason": "<one short sentence why it matters>" }],',
  '  "likelySpam": [{ "from": "<sender>", "subject": "<subject>" }]',
  "}",
  "",
  "Rules: include ONLY important emails in `important` and ONLY spam/ads in",
  "`likelySpam` — routine emails belong in neither array but DO count toward the",
  "summary. Use the exact sender and subject strings as given. If there are no",
  "emails, return empty arrays and a summary saying the inbox is empty.",
].join("\n");

/**
 * Generate an inbox briefing for a connected mailbox. Reads the most recent
 * messages (read-only) and uses the LLM to separate the real, important mail
 * from routine noise and spam/ads.
 *
 * @param mailbox  the connected mailbox email address (e.g. info@aquavoy.com)
 * @param opts     folder/limit + ChatOptions (identity/principal threaded to the LLM)
 */
export async function generateInboxBriefing(
  mailbox: string,
  opts: BriefingOptions = {},
): Promise<InboxBriefing> {
  const { folder, limit, ...chatOpts } = opts;
  const count = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const emails = await listEmails(mailbox, folder, count);
  const total = emails.length;

  if (total === 0) {
    return {
      mailbox,
      total: 0,
      important: [],
      likelySpam: [],
      summary: "The mailbox has no recent messages to brief.",
    };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_INSTRUCTION },
    {
      role: "user",
      content: `Here are the ${total} most recent emails in this mailbox. Triage them:\n\n${buildEmailList(emails)}`,
    },
  ];

  // The LLM call is the only network dependency besides listEmails. A thrown
  // error here (upstream 5xx, timeout) must not be swallowed by parse fallback —
  // it is a genuine failure the caller surfaces — but a *malformed reply* (bad
  // JSON) degrades gracefully via parseBriefing.
  const reply = await complete(messages, chatOpts);
  const { important, likelySpam, summary } = parseBriefing(reply, total);

  return { mailbox, total, important, likelySpam, summary };
}
