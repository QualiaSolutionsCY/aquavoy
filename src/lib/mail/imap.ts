import { ImapFlow } from "imapflow";
import type {
  ListResponse,
  FetchMessageObject,
  MessageEnvelopeObject,
  MessageAddressObject,
} from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import {
  loadAccountWithSecretByEmail,
  type MailAccountWithSecret,
} from "./accounts";

/**
 * IMAP read-only adapter — the ONLY file in the project that imports imapflow
 * or mailparser. Every public function takes an email address, loads the stored
 * credentials from Supabase, connects via IMAP TLS, performs a read-only
 * operation, and disconnects.
 */
// ADR-004: authoritative stack for this operation — IMAP/SMTP owns company mailboxes

const BODY_CAP = 12_000;
const DEFAULT_COUNT = 15;
const MAX_COUNT = 25;
const CONNECTION_TIMEOUT = 15_000;

// ── Internal connect helper ────────────────────────────────

function createClient(account: MailAccountWithSecret): ImapFlow {
  return new ImapFlow({
    host: account.imapHost ?? account.smtpHost,
    port: account.imapPort ?? 993,
    secure: true,
    auth: { user: account.username, pass: account.password },
    logger: false,
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: CONNECTION_TIMEOUT,
  });
}

async function withClient<T>(
  email: string,
  fn: (client: ImapFlow, account: MailAccountWithSecret) => Promise<T>,
): Promise<T> {
  const account = await loadAccountWithSecretByEmail(email);
  if (!account) {
    throw new Error(`No stored IMAP account for "${email}"`);
  }
  if (!account.imapHost) {
    throw new Error(`IMAP host not configured for "${email}"`);
  }
  const client = createClient(account);
  try {
    await client.connect();
    return await fn(client, account);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|login|credentials|password/i.test(msg)) {
      throw new Error(`IMAP login failed for ${email}: ${msg}`);
    }
    if (/connect|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(msg)) {
      throw new Error(`IMAP connection timed out for ${email}: ${msg}`);
    }
    throw new Error(`IMAP error for ${email}: ${msg}`);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

// ── Folder resolution ──────────────────────────────────────

/** Cached folder list for a single session (within one withClient call). */
async function fetchFolderList(client: ImapFlow): Promise<ListResponse[]> {
  return await client.list();
}

/**
 * Map a human-friendly hint ("inbox", "sent", "drafts", "trash", or an
 * explicit IMAP path) to the real mailbox path. Prefers special-use flags,
 * falls back to common folder names across locales.
 */
function resolveFolder(folders: ListResponse[], hint?: string): string {
  if (!hint) return "INBOX";
  const lower = hint.toLowerCase().trim();

  // Direct INBOX match
  if (lower === "inbox") return "INBOX";

  // Map hint to special-use flag
  const SPECIAL_USE_MAP: Record<string, string> = {
    sent: "\\Sent",
    drafts: "\\Drafts",
    draft: "\\Drafts",
    trash: "\\Trash",
    junk: "\\Junk",
    spam: "\\Junk",
    archive: "\\Archive",
    all: "\\All",
  };

  const flag = SPECIAL_USE_MAP[lower];
  if (flag) {
    const match = folders.find((f) => f.specialUse === flag);
    if (match) return match.path;
  }

  // Fallback: common folder names (English + Dutch + German)
  const NAME_FALLBACKS: Record<string, string[]> = {
    sent: [
      "Sent",
      "Sent Items",
      "Sent Messages",
      "INBOX.Sent",
      "Verzonden items",
      "Verzonden",
      "Gesendete Objekte",
      "Gesendete Elemente",
    ],
    drafts: [
      "Drafts",
      "INBOX.Drafts",
      "Concepten",
      "Entwürfe",
    ],
    draft: [
      "Drafts",
      "INBOX.Drafts",
      "Concepten",
    ],
    trash: [
      "Trash",
      "Deleted Items",
      "Deleted Messages",
      "INBOX.Trash",
      "Prullenbak",
      "Verwijderde items",
      "Papierkorb",
    ],
    junk: [
      "Junk",
      "Junk E-mail",
      "Spam",
      "INBOX.Junk",
      "Ongewenste e-mail",
    ],
  };

  const fallbacks = NAME_FALLBACKS[lower];
  if (fallbacks) {
    for (const name of fallbacks) {
      const match = folders.find(
        (f) => f.path.toLowerCase() === name.toLowerCase(),
      );
      if (match) return match.path;
    }
  }

  // If the hint looks like an explicit path, use it directly
  const exact = folders.find(
    (f) => f.path.toLowerCase() === lower,
  );
  if (exact) return exact.path;

  // Last resort: partial match on folder name
  const partial = folders.find(
    (f) => f.name.toLowerCase() === lower,
  );
  if (partial) return partial.path;

  throw new Error(
    `Folder not found for hint "${hint}". Available folders: ${folders.map((f) => f.path).join(", ")}`,
  );
}

// ── Envelope formatting helpers ────────────────────────────

function fmtAddr(addrs?: MessageAddressObject[]): string {
  if (!addrs || addrs.length === 0) return "";
  return addrs
    .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address ?? ""))
    .join(", ");
}

function fmtEnvelope(msg: FetchMessageObject) {
  const env = msg.envelope as MessageEnvelopeObject | undefined;
  return {
    uid: msg.uid,
    date: env?.date?.toISOString() ?? null,
    from: fmtAddr(env?.from),
    to: fmtAddr(env?.to),
    subject: env?.subject ?? "(no subject)",
    seen: msg.flags ? msg.flags.has("\\Seen") : null,
  };
}

// ── Public API ─────────────────────────────────────────────

export interface FolderInfo {
  path: string;
  name: string;
  specialUse: string | null;
  flags: string[];
}

export interface EmailSummary {
  uid: number;
  date: string | null;
  from: string;
  to: string;
  subject: string;
  seen: boolean | null;
}

export interface EmailDetail {
  uid: number;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  subject: string;
  body: string;
}

/**
 * List all folders/mailboxes for an account — paths + special-use flags.
 */
export async function listFolders(email: string): Promise<FolderInfo[]> {
  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    return folders.map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: f.specialUse ?? null,
      flags: Array.from(f.flags),
    }));
  });
}

/**
 * List the most recent emails in a folder. Opens mailbox read-only.
 * Returns newest first, up to `count` (max 25).
 */
export async function listEmails(
  email: string,
  folderHint?: string,
  count?: number,
): Promise<EmailSummary[]> {
  const limit = Math.min(Math.max(count ?? DEFAULT_COUNT, 1), MAX_COUNT);

  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const path = resolveFolder(folders, folderHint);
    const mailbox = await client.mailboxOpen(path, { readOnly: true });
    const total = mailbox.exists;
    if (total === 0) return [];

    // Fetch the LAST `limit` messages by sequence number (highest = newest)
    const startSeq = Math.max(1, total - limit + 1);
    const range = `${startSeq}:${total}`;

    const messages: EmailSummary[] = [];
    for await (const msg of client.fetch(range, {
      uid: true,
      envelope: true,
      flags: true,
    })) {
      messages.push(fmtEnvelope(msg));
    }

    // Newest first
    messages.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return b.uid - a.uid;
    });

    return messages;
  });
}

/**
 * Fetch a single email's full content by UID. Parses with mailparser.
 * Body is plain text preferred, HTML stripped as fallback, capped at 12k chars.
 */
export async function readEmail(
  email: string,
  folderHint: string | undefined,
  uid: number,
): Promise<EmailDetail> {
  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const path = resolveFolder(folders, folderHint);
    await client.mailboxOpen(path, { readOnly: true });

    // Download the full RFC822 source for this UID
    const download = await client.download(String(uid), undefined, {
      uid: true,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const source = Buffer.concat(chunks);

    const parsed = await simpleParser(source);

    // Prefer plain text; fall back to HTML with tags stripped
    let body = parsed.text ?? "";
    if (!body && parsed.html) {
      body = parsed.html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    if (body.length > BODY_CAP) {
      body = body.slice(0, BODY_CAP) + "\n\n... (truncated at 12000 chars)";
    }

    const fmtParsedAddr = (
      val: AddressObject | AddressObject[] | undefined,
    ): string => {
      if (!val) return "";
      const list: AddressObject[] = Array.isArray(val) ? val : [val];
      return list
        .flatMap((v) =>
          v.value.map((a: { name?: string; address?: string }) =>
            a.name ? `${a.name} <${a.address}>` : a.address ?? "",
          ),
        )
        .join(", ");
    };

    return {
      uid,
      from: fmtParsedAddr(parsed.from),
      to: fmtParsedAddr(parsed.to),
      cc: fmtParsedAddr(parsed.cc),
      date: parsed.date?.toISOString() ?? null,
      subject: parsed.subject ?? "(no subject)",
      body,
    };
  });
}

/**
 * Search emails in a folder by text, sender, and/or date. Opens mailbox
 * read-only. Returns envelope summaries, newest first.
 */
export async function searchEmails(
  email: string,
  folderHint?: string,
  opts?: { text?: string; from?: string; since?: string },
  count?: number,
): Promise<EmailSummary[]> {
  const limit = Math.min(Math.max(count ?? DEFAULT_COUNT, 1), MAX_COUNT);

  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const path = resolveFolder(folders, folderHint);
    await client.mailboxOpen(path, { readOnly: true });

    // Build IMAP search query
    const query: Record<string, unknown> = {};
    if (opts?.text) query.text = opts.text;
    if (opts?.from) query.from = opts.from;
    if (opts?.since) query.since = new Date(opts.since);

    // If no criteria given, match all
    if (Object.keys(query).length === 0) query.all = true;

    const uids = await client.search(query, { uid: true });
    if (!uids || uids.length === 0) return [];

    // Take only the last `limit` UIDs (newest)
    const uidList = (uids as number[]).slice(-limit);
    const uidRange = uidList.join(",");

    const messages: EmailSummary[] = [];
    for await (const msg of client.fetch(uidRange, {
      uid: true,
      envelope: true,
      flags: true,
    }, { uid: true })) {
      messages.push(fmtEnvelope(msg));
    }

    messages.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      return b.uid - a.uid;
    });

    return messages;
  });
}
