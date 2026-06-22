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

// pdf-parse's getText() result is controllable per-test so we can exercise the
// empty-text branch (scanned/image-only PDF) without a real vendor parse.
const { pdfTextMock } = vi.hoisted(() => ({
  pdfTextMock: vi.fn(async () => ({ text: "PDF TEXT" })),
}));
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    getText = pdfTextMock;
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

const { sendMailMock, loadAccountMock, listAccountsMock, stageMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => undefined),
  loadAccountMock: vi.fn(),
  listAccountsMock: vi.fn(async () => [] as Array<{ email: string }>),
  stageMock: vi.fn(async () => ({ id: "pa-1", summary: "Send email to x" })),
}));

vi.mock("@/lib/mail/smtp", () => ({ sendMail: sendMailMock }));
vi.mock("@/lib/mail/accounts", () => ({
  loadAccountWithSecretByEmail: loadAccountMock,
  listAccounts: listAccountsMock,
}));

// Destructive tools are STAGED, never executed in the model loop (ADR-003).
// The pendingActions seam is mocked so executeTool's gate is tested in isolation.
vi.mock("@/lib/agents/pendingActions", () => ({ stagePendingAction: stageMock }));

import { executeTool } from "./onedriveTools";
import { recallMemory } from "@/lib/agents/memoryTools";
import { downloadContent, getItem, deleteItem } from "@/lib/microsoft/onedrive";

const recallMemoryMock = vi.mocked(recallMemory);
const downloadContentMock = vi.mocked(downloadContent);
const getItemMock = vi.mocked(getItem);
const deleteItemMock = vi.mocked(deleteItem);

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
    stageMock.mockClear();
  });

  // send_email is a DESTRUCTIVE tool (ADR-003): executeTool no longer sends
  // inline. It STAGES a pending_actions row and returns confirmation_required;
  // the actual SMTP send runs later via the confirm endpoint. The three cases
  // below assert the NEW staged behavior — the SMTP seam (sendMailMock) is never
  // touched here.

  it("send_email stages a pending action and returns confirmation_required (no inline send)", async () => {
    const out = await executeTool(
      "send_email",
      {
        from: "info@aquavoy.com",
        to: "client@example.com",
        subject: "Hello",
        body: "Body text",
      },
      null,
      "Wency",
    );
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("confirmation_required");
    expect(parsed.action_id).toBe("pa-1");
    expect(typeof parsed.summary).toBe("string");
    // The gate runs BEFORE any side-effect: SMTP is never called.
    expect(sendMailMock).not.toHaveBeenCalled();
    // The staged row is owned by the verified session principal.
    expect(stageMock).toHaveBeenCalledTimes(1);
    expect(stageMock).toHaveBeenCalledWith(
      expect.objectContaining({ principal: "Wency", tool: "send_email" }),
    );
  });

  it("send_email stages even with empty fields — validation defers to confirm, nothing is sent", async () => {
    const out = await executeTool(
      "send_email",
      { from: "x", to: "", subject: "", body: "" },
      null,
      "Wency",
    );
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("confirmation_required");
    expect(parsed.action_id).toBe("pa-1");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("send_email fails closed without a verified session principal and never stages or sends", async () => {
    const out = await executeTool(
      "send_email",
      {
        from: "ghost@aquavoy.com",
        to: "client@example.com",
        subject: "Hi",
        body: "Body",
      },
      null,
      // no sessionPrincipal — the staged row must be owned by a verified identity
      undefined,
    );
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe("no verified principal in session");
    expect(stageMock).not.toHaveBeenCalled();
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

describe("agents/onedriveTools destructive gating (ADR-003)", () => {
  beforeEach(() => {
    stageMock.mockClear();
    deleteItemMock.mockReset();
  });

  it("AC1: delete_item is staged, not executed — the OneDrive deleteItem side-effect never runs", async () => {
    const out = await executeTool("delete_item", { itemId: "x" }, null, "Wency");
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("confirmation_required");
    expect(parsed.action_id).toBe("pa-1");
    // The gate returns before any switch case — the destructive Graph call is never reached.
    expect(deleteItemMock).not.toHaveBeenCalled();
  });

  it("AC2: the staged row is owned by the verified session principal (Wency)", async () => {
    await executeTool("delete_item", { itemId: "x" }, null, "Wency");
    expect(stageMock).toHaveBeenCalledTimes(1);
    expect(stageMock).toHaveBeenCalledWith(
      expect.objectContaining({ principal: "Wency", tool: "delete_item", args: { itemId: "x" } }),
    );
  });

  it("fails closed without a verified principal — delete_item is neither staged nor executed", async () => {
    const out = await executeTool("delete_item", { itemId: "x" }, null, undefined);
    expect(JSON.parse(out).error).toBe("no verified principal in session");
    expect(stageMock).not.toHaveBeenCalled();
    expect(deleteItemMock).not.toHaveBeenCalled();
  });
});

describe("agents/onedriveTools read_file — inline document understanding (M2-P2)", () => {
  beforeEach(() => {
    downloadContentMock.mockReset();
    getItemMock.mockReset();
    // Restore the default non-empty PDF parse result; the empty-text case below
    // overrides it for a single call.
    pdfTextMock.mockReset();
    pdfTextMock.mockResolvedValue({ text: "PDF TEXT" });
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

  it("AC6b: a URL-ENCODED OneDrive name still dispatches by extension (regression: '(unknown) file' bug)", async () => {
    // OneDrive hands back the name percent-encoded, so ".pdf" arrives as "%2Epdf".
    // Before the decode fix this matched no branch and fell through to the
    // unknown-binary message — read_file returned no usable text and the agent
    // went silent ("(no response)") on real employee/file lookups.
    downloadContentMock.mockResolvedValueOnce(
      fileResponse("binary", "Fam%20J%20Alves%20Monteiro%2Epdf"),
    );
    const out = await executeTool("read_file", { itemId: "item-enc" }, "conn-1");
    const parsed = JSON.parse(out);
    expect(parsed.content).toBe("PDF TEXT");
    expect(parsed.content).not.toContain("Cannot extract text");
  });

  it("A10: a scanned/image-only PDF (empty parse) returns an explanatory message, never empty", async () => {
    // pdf-parse yields whitespace-only text for a scanned, image-only PDF.
    pdfTextMock.mockResolvedValueOnce({ text: "   \n  " });
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "contract.pdf"));
    const out = await executeTool("read_file", { itemId: "item-scan" }, "conn-1");
    const content = JSON.parse(out).content;
    expect(content).toContain('The PDF "contract.pdf" contains no extractable text');
    expect(content).toContain("scanned image");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("A10: a failed PDF parse (throw) returns an explanatory message, never throws or empties", async () => {
    pdfTextMock.mockRejectedValueOnce(new Error("Password required"));
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "locked.pdf"));
    const out = await executeTool("read_file", { itemId: "item-locked" }, "conn-1");
    const content = JSON.parse(out).content;
    expect(content).toContain('Could not read the PDF "locked.pdf"');
    expect(content).toContain("Password required");
    expect(content).toContain("password-protected");
  });

  it("AC6: dispatches .xlsx to the xlsx branch (CSV per sheet)", async () => {
    downloadContentMock.mockResolvedValueOnce(fileResponse("binary", "data.xlsx"));
    const out = await executeTool("read_file", { itemId: "item-7" }, "conn-1");
    const content = JSON.parse(out).content;
    expect(content).toContain("Sheet: Sheet1");
    expect(content).toContain("a,b");
  });
});
