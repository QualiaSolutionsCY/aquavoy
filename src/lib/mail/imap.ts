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

export interface AttachmentInfo {
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailDetail {
  uid: number;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  subject: string;
  body: string;
  attachments: AttachmentInfo[];
}

export interface DownloadedAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface SenderMatchPreview {
  folderPath: string;
  total: number;
  sample: EmailSummary[];
  uids: number[];
  messageIds: Record<number, string>;
}

export interface MoveResult {
  movedCount: number;
  destFolderPath: string;
  uidMap: Record<number, number>;
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

    // Map attachment metadata — drop content bytes (bytes only at download time)
    const attachments: AttachmentInfo[] = (parsed.attachments ?? []).map(
      (att, i) => ({
        filename: att.filename ?? `attachment-${i}`,
        contentType: att.contentType ?? "application/octet-stream",
        size: att.size ?? att.content?.length ?? 0,
      }),
    );

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
      attachments,
    };
  });
}

/**
 * Download the raw bytes of a named attachment from an email. Opens the
 * mailbox read-only, re-parses the message via mailparser, and finds the
 * attachment by filename (exact match; falls back to case-insensitive trim).
 * Returns the attachment bytes as a Uint8Array — no content bytes are stored
 * on the server; this function must be called explicitly at confirm time.
 */
export async function downloadAttachment(
  email: string,
  folderHint: string | undefined,
  uid: number,
  filename: string,
): Promise<DownloadedAttachment> {
  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const path = resolveFolder(folders, folderHint);
    await client.mailboxOpen(path, { readOnly: true });

    const download = await client.download(String(uid), undefined, {
      uid: true,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const source = Buffer.concat(chunks);

    const parsed = await simpleParser(source);

    // Exact match first, then case-insensitive trim fallback
    const att =
      (parsed.attachments ?? []).find((a) => a.filename === filename) ??
      (parsed.attachments ?? []).find(
        (a) => (a.filename ?? "").toLowerCase().trim() === filename.toLowerCase().trim(),
      );

    if (!att) {
      throw new Error(`Attachment "${filename}" not found on message ${uid}`);
    }

    return {
      filename: att.filename ?? filename,
      contentType: att.contentType ?? "application/octet-stream",
      bytes: new Uint8Array(att.content),
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

// ── Write API (move) ───────────────────────────────────────

/**
 * Preview which messages in a folder match a given sender BEFORE moving them.
 * Opens the resolved folder read-only, searches by sender, and returns the
 * full matched UID set plus a sample of the newest envelopes for confirmation.
 */
export async function previewSenderMatches(
  email: string,
  folderHint: string | undefined,
  from: string,
  sampleSize = 5,
): Promise<SenderMatchPreview> {
  const size = Math.max(sampleSize, 0);

  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const folderPath = resolveFolder(folders, folderHint);
    await client.mailboxOpen(folderPath, { readOnly: true });

    const found = await client.search({ from }, { uid: true });
    const uids = (found ?? []) as number[];
    if (uids.length === 0) {
      return { folderPath, total: 0, sample: [], uids: [], messageIds: {} };
    }

    // Capture the Message-ID (RFC822 header) for every matched UID. Message-IDs
    // survive a folder move, so undo can re-locate the moved messages on servers
    // that lack the UIDPLUS extension (§A1: uidMap is then empty).
    const messageIds: Record<number, string> = {};
    for await (const msg of client.fetch(
      uids.join(","),
      { uid: true, envelope: true },
      { uid: true },
    )) {
      const id = msg.envelope?.messageId ?? "";
      if (id) messageIds[msg.uid] = id;
    }

    const sample: EmailSummary[] = [];
    if (size > 0) {
      // Take the newest `size` UIDs (search returns ascending UID order).
      const sampleUids = uids.slice(-size);
      for await (const msg of client.fetch(
        sampleUids.join(","),
        { uid: true, envelope: true, flags: true },
        { uid: true },
      )) {
        sample.push(fmtEnvelope(msg));
      }
      sample.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        return b.uid - a.uid;
      });
    }

    return { folderPath, total: uids.length, sample, uids, messageIds };
  });
}

/**
 * Resolve the mailbox's Trash special-use folder path for an account.
 * Uses the same resolveFolder logic as the read ops.
 */
export async function resolveTrashFolder(email: string): Promise<string> {
  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    return resolveFolder(folders, "trash");
  });
}

/**
 * Move a set of UIDs from a source folder to a destination folder. Opens the
 * source folder read-WRITE and uses imapflow `messageMove`. Returns the count
 * moved, the resolved destination path, and the source→dest UID map (present
 * when the server has the UIDPLUS extension).
 */
export async function moveMessages(
  email: string,
  sourceFolderHint: string | undefined,
  uids: number[],
  destFolderHint: string,
): Promise<MoveResult> {
  if (uids.length === 0) {
    throw new Error("moveMessages requires at least one UID");
  }

  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const sourcePath = resolveFolder(folders, sourceFolderHint);
    const destPath = resolveFolder(folders, destFolderHint);

    // Read-WRITE: MOVE expels messages from the source mailbox.
    await client.mailboxOpen(sourcePath);

    const res = await client.messageMove(uids.join(","), destPath, {
      uid: true,
    });
    const uidMap = Object.fromEntries(
      res && res.uidMap ? res.uidMap : new Map<number, number>(),
    ) as Record<number, number>;

    return { movedCount: uids.length, destFolderPath: destPath, uidMap };
  });
}

/**
 * Reverse a batch move using Message-IDs instead of UIDs. Capability-independent
 * undo path (§A1): when the server lacks UIDPLUS, the forward move returns no
 * uidMap, so undo cannot target the messages by their new UID. Message-IDs
 * (RFC822 header) survive the move, so we open the folder the messages now live
 * in, search each Message-ID, and move the matched UIDs back to the destination.
 */
export async function moveMessagesByMessageId(
  email: string,
  fromFolderHint: string,
  messageIds: string[],
  destFolderHint: string,
): Promise<{ movedCount: number; destFolderPath: string }> {
  if (messageIds.length === 0) {
    throw new Error("moveMessagesByMessageId requires at least one Message-ID");
  }

  return withClient(email, async (client) => {
    const folders = await fetchFolderList(client);
    const fromPath = resolveFolder(folders, fromFolderHint);
    const destPath = resolveFolder(folders, destFolderHint);

    // Read-WRITE: MOVE expels messages from the source mailbox.
    await client.mailboxOpen(fromPath);

    const found = new Set<number>();
    for (const id of messageIds) {
      const matched = await client.search(
        { header: { "message-id": id } },
        { uid: true },
      );
      for (const uid of (matched ?? []) as number[]) found.add(uid);
    }

    const foundUids = Array.from(found);
    if (foundUids.length > 0) {
      await client.messageMove(foundUids.join(","), destPath, { uid: true });
    }

    return { movedCount: foundUids.length, destFolderPath: destPath };
  });
}
