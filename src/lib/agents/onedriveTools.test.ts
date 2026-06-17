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

// Parser libs are mocked: we test OUR extraction dispatch + read_file wiring,
// not the vendor libraries themselves (rules/architecture.md §6).
vi.mock("mammoth", () => ({ extractRawText: vi.fn(async () => ({ value: "DOCX TEXT" })) }));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = async () => ({ text: "PDF TEXT" });
  },
}));
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
  utils: { sheet_to_csv: vi.fn(() => "a,b\n1,2") },
}));

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
import { recallMemory } from "@/lib/agents/memoryTools";
import { downloadContent, getItem } from "@/lib/microsoft/onedrive";

const recallMemoryMock = vi.mocked(recallMemory);
const downloadContentMock = vi.mocked(downloadContent);
const getItemMock = vi.mocked(getItem);

/** Build a fetch Response with optional content-disposition filename. */
function fileResponse(body: string, fileName?: string): Response {
  const headers = new Headers();
  if (fileName) headers.set("content-disposition", `attachment; filename="${fileName}"`);
  return new Response(body, { headers });
}

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

describe("agents/onedriveTools recall_memory principal pinning (REQ-3)", () => {
  beforeEach(() => recallMemoryMock.mockReset());

  it("pins recall to the verified session principal, ignoring args.principal", async () => {
    recallMemoryMock.mockResolvedValueOnce(JSON.stringify({ hits: [] }));
    // Attacker steers the model: logged in as Wency, asks for Jeanette's memory.
    await executeTool("recall_memory", { query: "pricing", principal: "Jeanette" }, null, "Wency");
    // The session identity wins — never the model-supplied principal.
    expect(recallMemoryMock).toHaveBeenCalledWith("pricing", "Wency");
    expect(recallMemoryMock).not.toHaveBeenCalledWith("pricing", "Jeanette");
  });

  it("fails closed when there is no verified session principal", async () => {
    const out = await executeTool("recall_memory", { query: "pricing", principal: "Jeanette" }, null, undefined);
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("no verified principal in session");
    expect(recallMemoryMock).not.toHaveBeenCalled();
  });
});

describe("agents/onedriveTools read_file — inline document understanding (M2-P2)", () => {
  beforeEach(() => {
    downloadContentMock.mockReset();
    getItemMock.mockReset();
  });

  it("AC1: extracts text content from a downloaded text file", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("hello from notes", "notes.txt"));
    const out = await executeTool("read_file", { itemId: "item-1" }, "conn-1");
    const parsed = JSON.parse(out);
    expect(parsed.fileName).toBe("notes.txt");
    expect(parsed.content).toBe("hello from notes");
  });

  it("AC2: falls back to getItem for the filename when content-disposition is absent", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("body text")); // no filename header
    getItemMock.mockResolvedValueOnce({ name: "fallback.txt" } as Awaited<ReturnType<typeof getItem>>);
    const out = await executeTool("read_file", { itemId: "item-2" }, "conn-1");
    const parsed = JSON.parse(out);
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(parsed.fileName).toBe("fallback.txt");
    expect(parsed.content).toBe("body text");
  });

  it("AC3: returns a clean message for unsupported binary types instead of crashing", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("\x89PNG\r\n", "logo.png"));
    const out = await executeTool("read_file", { itemId: "item-3" }, "conn-1");
    const parsed = JSON.parse(out);
    expect(parsed.fileName).toBe("logo.png");
    expect(parsed.content).toContain("Cannot extract text");
  });

  it("AC4: truncates content longer than the 12000-char cap with a note", async () => {
    const big = "x".repeat(13_000);
    downloadContentMock.mockResolvedValueOnce(fileResponse(big, "big.txt"));
    const out = await executeTool("read_file", { itemId: "item-4" }, "conn-1");
    const parsed = JSON.parse(out);
    expect(parsed.content.endsWith("(truncated)")).toBe(true);
    expect(parsed.content.length).toBeLessThan(big.length);
  });

  it("AC5: returns an error when itemId is missing, without downloading", async () => {
    const out = await executeTool("read_file", {}, "conn-1");
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("itemId is required");
    expect(downloadContentMock).not.toHaveBeenCalled();
  });

  it("AC6: dispatches .docx to the mammoth branch", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "report.docx"));
    const out = await executeTool("read_file", { itemId: "item-5" }, "conn-1");
    expect(JSON.parse(out).content).toBe("DOCX TEXT");
  });

  it("AC6: dispatches .pdf to the pdf-parse branch", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "report.pdf"));
    const out = await executeTool("read_file", { itemId: "item-6" }, "conn-1");
    expect(JSON.parse(out).content).toBe("PDF TEXT");
  });

  it("AC6: dispatches .xlsx to the xlsx branch (CSV per sheet)", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "data.xlsx"));
    const out = await executeTool("read_file", { itemId: "item-7" }, "conn-1");
    const content = JSON.parse(out).content;
    expect(content).toContain("Sheet: Sheet1");
    expect(content).toContain("a,b");
  });
});
