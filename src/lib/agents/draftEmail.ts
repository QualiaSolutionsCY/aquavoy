import { complete } from "@/lib/openrouter/client";

/**
 * The email-preparation agent — the front-of-house for the CrewAI automation.
 * Given a recipient and an intent, it drafts a personalized 1:1 email and
 * returns a clean { subject, body }. Web search is optional, for when the brief
 * needs current facts.
 */

export interface Recipient {
  name: string;
  email: string;
  role?: string | null;
  notes?: string | null;
}

export interface DraftedEmail {
  subject: string;
  body: string;
}

const SYSTEM = [
  "You are Aquavoy's email-preparation agent, working for Wency.",
  "You write personalized, one-to-one (1:1) emails that sound human and warm —",
  "never templated or robotic. Keep them concise and purposeful.",
  "Return ONLY a JSON object: {\"subject\": string, \"body\": string}.",
  "The body is plain text with real line breaks. No markdown, no preamble.",
].join("\n");

/** Pull the first balanced JSON object out of a model response. */
function extractJson(text: string): DraftedEmail {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    // Fall back: treat the whole thing as the body.
    return { subject: "", body: text.trim() };
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Partial<DraftedEmail>;
    return { subject: obj.subject ?? "", body: obj.body ?? "" };
  } catch {
    return { subject: "", body: text.trim() };
  }
}

export async function draftEmail(
  recipient: Recipient,
  intent: string,
  opts: { web?: boolean; sender?: string } = {},
): Promise<DraftedEmail> {
  const ctx = [
    `Recipient name: ${recipient.name}`,
    recipient.role ? `Recipient role: ${recipient.role}` : "",
    recipient.notes ? `Context about them: ${recipient.notes}` : "",
    opts.sender ? `Sender (sign off as): ${opts.sender}` : "Sender: Wency",
    "",
    `Brief / what this email should achieve:`,
    intent,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await complete(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: ctx },
    ],
    { web: opts.web },
  );
  return extractJson(raw);
}
