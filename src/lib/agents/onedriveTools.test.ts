import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the agent tool dispatcher. Every downstream adapter the module
 * imports is mocked so executeTool() runs in isolation — no Graph, IMAP, SMTP,
 * Supabase, or web call. Asserts: valid send_email -> success JSON; missing
 * fields -> validation-error JSON; unknown tool -> readable error, no throw.
 */
vi.mock("@/lib/microsoft/onedrive", () => ({
  listChildren: vi.fn(),
  search: vi.fn(),
  downloadContent: vi.fn(),
  createFolder: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  getItem: vi.fn(),
}));

vi.mock("@/lib/microsoft/connections", () => ({
  resolveConnectionId: vi.fn(async () => "conn-1"),
}));

vi.mock("@/lib/agents/tavily", () => ({ tavilySearch: vi.fn() }));
vi.mock("@/lib/agents/memoryTools", () => ({ recallMemory: vi.fn() }));

vi.mock("@/lib/mail/scheduled", () => ({
  scheduleEmail: vi.fn(),
  listScheduled: vi.fn(),
  cancelScheduled: vi.fn(),
}));

vi.mock("@/lib/mail/imap", () => ({
  listFolders: vi.fn(),
  listEmails: vi.fn(),
  readEmail: vi.fn(),
  searchEmails: vi.fn(),
}));

const { sendMailMock, loadAccountMock, listAccountsMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => undefined),
  loadAccountMock: vi.fn(),
  listAccountsMock: vi.fn(async () => [] as Array<{ email: string }>),
}));

vi.mock("@/lib/mail/smtp", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/mail/accounts", () => ({
  loadAccountWithSecretByEmail: loadAccountMock,
  listAccounts: listAccountsMock,
}));

import { executeTool } from "./onedriveTools";

const account = {
  id: "acct-1",
  email: "info@aquavoy.com",
  displayName: "Aquavoy",
  smtpHost: "smtp.aquavoy.com",
  smtpPort: 465,
  imapHost: null,
  imapPort: null,
  username: "info@aquavoy.com",
  password: "secret",
  verifiedAt: null,
};

describe("agents/onedriveTools executeTool", () => {
  beforeEach(() => {
    sendMailMock.mockClear();
    loadAccountMock.mockReset();
    listAccountsMock.mockClear();
  });

  it("send_email with valid args returns success JSON", async () => {
    loadAccountMock.mockResolvedValueOnce(account);
    const out = await executeTool("send_email", {
      from: "info@aquavoy.com",
      to: "client@example.com",
      subject: "Hello",
      body: "Body text",
    });
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ sent: true, from: "info@aquavoy.com", to: "client@example.com" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("send_email with empty fields returns a validation-error JSON without sending", async () => {
    const out = await executeTool("send_email", { from: "x", to: "", subject: "", body: "" });
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("from, to, subject, and body are all required");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("send_email with no connected account returns a helpful error JSON", async () => {
    loadAccountMock.mockResolvedValueOnce(null);
    listAccountsMock.mockResolvedValueOnce([{ email: "other@aquavoy.com" }]);
    const out = await executeTool("send_email", {
      from: "ghost@aquavoy.com",
      to: "client@example.com",
      subject: "Hi",
      body: "Body",
    });
    const parsed = JSON.parse(out);
    expect(parsed.error).toContain("No connected mail account");
    expect(parsed.connected_addresses).toEqual(["other@aquavoy.com"]);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("unknown_tool returns a readable error string without throwing", async () => {
    const out = await executeTool("unknown_tool", {});
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("Unknown tool: unknown_tool");
  });
});
