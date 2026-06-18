import { graphJson } from "./graph";

/**
 * Outlook mail operations over Microsoft Graph, in project-internal terms. Same
 * seam pattern as onedrive.ts — route handlers stay thin around these calls.
 * Covers the 1:1 email-preparation surface: send, save-as-draft, list inbox.
 */
// ADR-004: authoritative stack — Outlook is user-personal drafting/send only, never company mailboxes

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Plain-text or HTML body; `html` flags which. */
  body: string;
  html?: boolean;
  cc?: string[];
}

export interface MailMessage {
  id: string;
  subject: string;
  from: string | null;
  preview: string;
  receivedAt: string;
  isRead: boolean;
  webLink?: string;
}

function recipients(addresses: string[]) {
  return addresses.map((a) => ({ emailAddress: { address: a } }));
}

function toGraphMessage(email: OutgoingEmail) {
  return {
    subject: email.subject,
    body: { contentType: email.html ? "HTML" : "Text", content: email.body },
    toRecipients: recipients([email.to]),
    ...(email.cc?.length ? { ccRecipients: recipients(email.cc) } : {}),
  };
}

/** Send an email immediately as the connected user. */
export async function sendMail(connectionId: string, email: OutgoingEmail): Promise<void> {
  await graphJson<void>(connectionId, {
    method: "POST",
    path: "/me/sendMail",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: toGraphMessage(email), saveToSentItems: true }),
  });
}

/**
 * Create a draft in the user's Outlook (Drafts folder) without sending — the
 * "preparation" path. Returns the draft id + web link so the user can open it.
 */
export async function createDraft(
  connectionId: string,
  email: OutgoingEmail,
): Promise<{ id: string; webLink?: string }> {
  const data = await graphJson<{ id: string; webLink?: string }>(connectionId, {
    method: "POST",
    path: "/me/messages",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toGraphMessage(email)),
  });
  return { id: data.id, webLink: data.webLink };
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  webLink?: string;
  from?: { emailAddress?: { address?: string } };
}

/** List recent inbox messages (metadata only). */
export async function listInbox(connectionId: string, top = 25): Promise<MailMessage[]> {
  const data = await graphJson<{ value: GraphMessage[] }>(connectionId, {
    path:
      `/me/mailFolders/inbox/messages?$top=${top}` +
      "&$select=id,subject,bodyPreview,receivedDateTime,isRead,webLink,from" +
      "&$orderby=receivedDateTime desc",
  });
  return data.value.map((m) => ({
    id: m.id,
    subject: m.subject ?? "(no subject)",
    from: m.from?.emailAddress?.address ?? null,
    preview: m.bodyPreview ?? "",
    receivedAt: m.receivedDateTime ?? "",
    isRead: Boolean(m.isRead),
    webLink: m.webLink,
  }));
}
