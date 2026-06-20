import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the IMAP read adapter. ImapFlow, mailparser, and the account
 * store are all mocked — no socket is opened. Asserts credential loading,
 * folder resolution, envelope formatting, and full-message parse.
 */

// ── Fake ImapFlow client (hoisted so the mock factory can reach it) ──
const h = vi.hoisted(() => {
  const folders = [
    { path: "INBOX", name: "INBOX", specialUse: undefined, flags: new Set<string>() },
    { path: "Sent Items", name: "Sent Items", specialUse: "\\Sent", flags: new Set<string>() },
    { path: "Trash", name: "Trash", specialUse: "\\Trash", flags: new Set<string>() },
  ];

  const inboxMessages = [
    {
      uid: 11,
      flags: new Set(["\\Seen"]),
      envelope: {
        date: new Date("2026-06-01T10:00:00Z"),
        from: [{ name: "Alice", address: "alice@example.com" }],
        to: [{ name: null, address: "info@aquavoy.com" }],
        subject: "First",
      },
    },
    {
      uid: 12,
      flags: new Set<string>(),
      envelope: {
        date: new Date("2026-06-02T10:00:00Z"),
        from: [{ name: "Bob", address: "bob@example.com" }],
        to: [{ name: null, address: "info@aquavoy.com" }],
        subject: "Second",
      },
    },
  ];

  function makeFakeClient() {
    return {
      connect: vi.fn(async () => undefined),
      list: vi.fn(async () => folders),
      mailboxOpen: vi.fn(async () => ({ exists: inboxMessages.length })),
      fetch: vi.fn(function* () {
        for (const m of inboxMessages) yield m;
      }),
      download: vi.fn(async () => ({
        content: (function* () {
          yield Buffer.from("raw-rfc822-source");
        })(),
      })),
      search: vi.fn(async () => [11, 12]),
      messageMove: vi.fn(async () => ({ uidMap: new Map([[11, 101], [12, 102]]) })),
      logout: vi.fn(async () => undefined),
      close: vi.fn(() => undefined),
    };
  }

  // Mutable ref the constructor returns; reset per test.
  const ref = { current: makeFakeClient() };
  return { makeFakeClient, ref };
});

vi.mock("imapflow", () => ({
  // ImapFlow is `new`ed in createClient — return the current fake instance.
  ImapFlow: vi.fn(function () {
    return h.ref.current;
  }),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(async () => ({
    text: "Parsed plain-text body.",
    html: null,
    from: { value: [{ name: "Alice", address: "alice@example.com" }] },
    to: { value: [{ name: null, address: "info@aquavoy.com" }] },
    cc: undefined,
    date: new Date("2026-06-01T10:00:00Z"),
    subject: "First",
  })),
}));

vi.mock("./accounts", () => ({
  loadAccountWithSecretByEmail: vi.fn(async () => ({
    id: "acct-1",
    email: "info@aquavoy.com",
    displayName: "Aquavoy",
    smtpHost: "smtp.aquavoy.com",
    smtpPort: 465,
    imapHost: "imap.aquavoy.com",
    imapPort: 993,
    username: "info@aquavoy.com",
    password: "decrypted-secret",
    verifiedAt: null,
  })),
}));

import {
  listFolders,
  listEmails,
  readEmail,
  searchEmails,
  previewSenderMatches,
  moveMessages,
  resolveTrashFolder,
} from "./imap";
import { loadAccountWithSecretByEmail } from "./accounts";

describe("mail/imap read adapter", () => {
  beforeEach(() => {
    h.ref.current = h.makeFakeClient();
    vi.mocked(loadAccountWithSecretByEmail).mockClear();
  });

  it("listFolders loads the account and returns folder paths + special-use", async () => {
    const result = await listFolders("info@aquavoy.com");
    expect(loadAccountWithSecretByEmail).toHaveBeenCalledWith("info@aquavoy.com");
    expect(result).toEqual([
      { path: "INBOX", name: "INBOX", specialUse: null, flags: [] },
      { path: "Sent Items", name: "Sent Items", specialUse: "\\Sent", flags: [] },
      { path: "Trash", name: "Trash", specialUse: "\\Trash", flags: [] },
    ]);
  });

  it("listEmails returns envelope summaries newest-first", async () => {
    const result = await listEmails("info@aquavoy.com", "inbox");
    expect(result[0].subject).toBe("Second"); // 2026-06-02 newest
    expect(result[0].uid).toBe(12);
    expect(result[0].seen).toBe(false);
    expect(result[1].from).toBe("Alice <alice@example.com>");
    expect(result[1].seen).toBe(true);
  });

  it("readEmail downloads + parses a single message", async () => {
    const detail = await readEmail("info@aquavoy.com", "inbox", 11);
    expect(detail.uid).toBe(11);
    expect(detail.from).toBe("Alice <alice@example.com>");
    expect(detail.subject).toBe("First");
    expect(detail.body).toBe("Parsed plain-text body.");
    expect(h.ref.current.download).toHaveBeenCalled();
  });

  it("searchEmails resolves the Sent folder via special-use flag", async () => {
    const result = await searchEmails("info@aquavoy.com", "sent", { text: "hello" });
    expect(h.ref.current.mailboxOpen).toHaveBeenCalledWith("Sent Items", { readOnly: true });
    expect(result).toHaveLength(2);
  });

  it("throws a readable error when no account is stored", async () => {
    vi.mocked(loadAccountWithSecretByEmail).mockResolvedValueOnce(null);
    await expect(listFolders("nobody@nowhere.com")).rejects.toThrow(
      /No stored IMAP account/,
    );
  });

  it("previewSenderMatches returns matched count, sample, and full uid set", async () => {
    const preview = await previewSenderMatches(
      "info@aquavoy.com",
      "inbox",
      "alice@example.com",
      5,
    );
    expect(h.ref.current.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(h.ref.current.search).toHaveBeenCalledWith(
      { from: "alice@example.com" },
      { uid: true },
    );
    expect(preview.folderPath).toBe("INBOX");
    expect(preview.total).toBe(2);
    expect(preview.uids).toEqual([11, 12]);
    expect(preview.sample).toHaveLength(2);
    expect(preview.sample[0].subject).toBe("Second"); // newest first
  });

  it("previewSenderMatches returns empty shape when no messages match", async () => {
    h.ref.current.search = vi.fn(async () => []);
    const preview = await previewSenderMatches(
      "info@aquavoy.com",
      "inbox",
      "nobody@example.com",
    );
    expect(preview).toEqual({
      folderPath: "INBOX",
      total: 0,
      sample: [],
      uids: [],
    });
  });

  it("resolveTrashFolder resolves the \\Trash special-use folder", async () => {
    const path = await resolveTrashFolder("info@aquavoy.com");
    expect(path).toBe("Trash");
  });

  it("moveMessages opens source read-write, moves UIDs, returns uidMap", async () => {
    const result = await moveMessages("info@aquavoy.com", "inbox", [11, 12], "trash");
    // Source opened read-WRITE (no readOnly option).
    expect(h.ref.current.mailboxOpen).toHaveBeenCalledWith("INBOX");
    expect(h.ref.current.messageMove).toHaveBeenCalledWith("11,12", "Trash", {
      uid: true,
    });
    expect(result.movedCount).toBe(2);
    expect(result.destFolderPath).toBe("Trash");
    expect(result.uidMap).toEqual({ 11: 101, 12: 102 });
  });

  it("moveMessages rejects an empty UID set", async () => {
    await expect(
      moveMessages("info@aquavoy.com", "inbox", [], "trash"),
    ).rejects.toThrow(/at least one UID/);
  });
});
