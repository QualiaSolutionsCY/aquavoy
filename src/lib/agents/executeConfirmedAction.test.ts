import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for executeConfirmedAction — the ONLY place destructive side-effects
 * actually run (ADR-003 §3). Every downstream adapter it imports (Graph/OneDrive,
 * SMTP, scheduled mail, finance ledger, IMAP move) is mocked so the
 * argument-validation + undo-capture logic is tested in isolation: no Graph call,
 * no SMTP send, no DB write. For each real tool case we assert the validation it
 * actually performs and the undo_data it actually captures — not invented behavior.
 */

const { resolveConnIdMock } = vi.hoisted(() => ({
  resolveConnIdMock: vi.fn(async () => "conn-1"),
}));
vi.mock("@/lib/microsoft/connections", () => ({
  resolveConnectionId: resolveConnIdMock,
}));

vi.mock("@/lib/microsoft/onedrive", () => ({
  getItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

vi.mock("@/lib/mail/accounts", () => ({
  loadAccountWithSecretByEmail: vi.fn(),
}));

vi.mock("@/lib/mail/smtp", () => ({
  sendMail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/mail/scheduled", () => ({
  scheduleEmail: vi.fn(),
}));

vi.mock("@/lib/finance/ledger", () => ({
  recordFinanceEntry: vi.fn(),
}));

vi.mock("@/lib/mail/imap", () => ({
  moveMessages: vi.fn(),
}));

import { executeConfirmedAction } from "./executeConfirmedAction";
import { getItem, updateItem, deleteItem } from "@/lib/microsoft/onedrive";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";
import { scheduleEmail } from "@/lib/mail/scheduled";
import { recordFinanceEntry } from "@/lib/finance/ledger";
import { moveMessages } from "@/lib/mail/imap";

const getItemMock = vi.mocked(getItem);
const updateItemMock = vi.mocked(updateItem);
const deleteItemMock = vi.mocked(deleteItem);
const loadAccountMock = vi.mocked(loadAccountWithSecretByEmail);
const sendMailMock = vi.mocked(sendMail);
const scheduleEmailMock = vi.mocked(scheduleEmail);
const recordFinanceEntryMock = vi.mocked(recordFinanceEntry);
const moveMessagesMock = vi.mocked(moveMessages);

const PRINCIPAL = "Wency";

/** A minimal DriveItem the onedrive mocks return. */
function driveItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Q3 report.docx",
    isFolder: false,
    parentId: "folder-old",
    ...overrides,
  } as Awaited<ReturnType<typeof getItem>>;
}

/** An imap-stack account (the only stack send_email accepts). */
function imapAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    email: "info@aquavoy.com",
    displayName: "Aquavoy",
    mailStack: "imap" as const,
    smtpHost: "smtp.aquavoy.com",
    smtpPort: 465,
    imapHost: "imap.aquavoy.com",
    imapPort: 993,
    username: "info@aquavoy.com",
    password: "secret",
    verifiedAt: null,
    ...overrides,
  } as Awaited<ReturnType<typeof loadAccountWithSecretByEmail>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveConnIdMock.mockResolvedValue("conn-1");
});

describe("executeConfirmedAction — move_item", () => {
  it("happy path: captures the prior parentId/name for undo and returns the moved item", async () => {
    getItemMock.mockResolvedValue(driveItem({ parentId: "folder-old", name: "Q3 report.docx" }));
    updateItemMock.mockResolvedValue(
      driveItem({ id: "item-1", name: "Q3 report.docx", parentId: "folder-new", isFolder: false }),
    );

    const out = await executeConfirmedAction(
      "move_item",
      { itemId: "item-1", newParentId: "folder-new" },
      PRINCIPAL,
    );

    // Prior location captured BEFORE the move (undo can reverse it).
    expect(getItemMock).toHaveBeenCalledWith("conn-1", { itemId: "item-1" });
    expect(updateItemMock).toHaveBeenCalledWith("conn-1", "item-1", { newParentId: "folder-new" });
    expect(out.undo_data).toEqual({ priorParentId: "folder-old", priorName: "Q3 report.docx" });
    expect(out.result).toEqual({
      name: "Q3 report.docx",
      id: "item-1",
      isFolder: false,
      parentId: "folder-new",
    });
  });

  it("rejects when itemId or newParentId is missing, without touching Graph", async () => {
    await expect(
      executeConfirmedAction("move_item", { itemId: "item-1" }, PRINCIPAL),
    ).rejects.toThrow("itemId and newParentId are required");
    expect(getItemMock).not.toHaveBeenCalled();
    expect(updateItemMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — rename_item", () => {
  it("happy path: captures prior name for undo and renames", async () => {
    getItemMock.mockResolvedValue(driveItem({ name: "old-name.txt", parentId: "folder-old" }));
    updateItemMock.mockResolvedValue(driveItem({ id: "item-1", name: "new-name.txt", isFolder: false }));

    const out = await executeConfirmedAction(
      "rename_item",
      { itemId: "item-1", newName: "new-name.txt" },
      PRINCIPAL,
    );

    expect(updateItemMock).toHaveBeenCalledWith("conn-1", "item-1", { newName: "new-name.txt" });
    expect(out.undo_data).toEqual({ priorParentId: "folder-old", priorName: "old-name.txt" });
    expect((out.result as { name: string }).name).toBe("new-name.txt");
  });

  it("rejects when itemId or newName is missing", async () => {
    await expect(
      executeConfirmedAction("rename_item", { newName: "x" }, PRINCIPAL),
    ).rejects.toThrow("itemId and newName are required");
    expect(updateItemMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — delete_item", () => {
  it("happy path: deletes and captures prior parent/name for the audit record", async () => {
    getItemMock.mockResolvedValue(driveItem({ parentId: "folder-old", name: "junk.txt" }));
    deleteItemMock.mockResolvedValue(undefined);

    const out = await executeConfirmedAction("delete_item", { itemId: "item-1" }, PRINCIPAL);

    expect(deleteItemMock).toHaveBeenCalledWith("conn-1", "item-1");
    expect(out.result).toEqual({ deleted: true, itemId: "item-1" });
    expect(out.undo_data).toEqual({ priorParentId: "folder-old", priorName: "junk.txt" });
  });

  it("tolerates a getItem failure (best-effort metadata) and still deletes", async () => {
    getItemMock.mockRejectedValue(new Error("404 not found"));
    deleteItemMock.mockResolvedValue(undefined);

    const out = await executeConfirmedAction("delete_item", { itemId: "item-1" }, PRINCIPAL);

    expect(deleteItemMock).toHaveBeenCalledWith("conn-1", "item-1");
    // undo_data falls back to nulls when the pre-delete read failed.
    expect(out.undo_data).toEqual({ priorParentId: null, priorName: null });
  });

  it("rejects when itemId is missing, without deleting", async () => {
    await expect(executeConfirmedAction("delete_item", {}, PRINCIPAL)).rejects.toThrow(
      "itemId is required",
    );
    expect(deleteItemMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — send_email", () => {
  const fullArgs = {
    from: "info@aquavoy.com",
    to: "client@example.com",
    subject: "Hello",
    body: "Body text",
  };

  it("happy path: sends through the imap account and returns no undo_data (send is irreversible)", async () => {
    loadAccountMock.mockResolvedValue(imapAccount());

    const out = await executeConfirmedAction("send_email", fullArgs, PRINCIPAL);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(out.result).toEqual({
      sent: true,
      from: "info@aquavoy.com",
      to: "client@example.com",
      subject: "Hello",
    });
    expect(out.undo_data).toBeNull();
  });

  it("rejects empty body (and any missing required field) before touching the account store", async () => {
    await expect(
      executeConfirmedAction("send_email", { ...fullArgs, body: "" }, PRINCIPAL),
    ).rejects.toThrow("from, to, subject, and body are all required");
    expect(loadAccountMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("rejects an empty 'to' address before sending", async () => {
    await expect(
      executeConfirmedAction("send_email", { ...fullArgs, to: "" }, PRINCIPAL),
    ).rejects.toThrow("from, to, subject, and body are all required");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("rejects when no connected mail account exists for 'from'", async () => {
    loadAccountMock.mockResolvedValue(null);
    await expect(executeConfirmedAction("send_email", fullArgs, PRINCIPAL)).rejects.toThrow(
      'No connected mail account for "info@aquavoy.com".',
    );
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("refuses a non-IMAP stack mailbox — no silent cross-stack fallback (ADR-004 / REQ-16)", async () => {
    loadAccountMock.mockResolvedValue(imapAccount({ mailStack: "outlook" }));
    await expect(executeConfirmedAction("send_email", fullArgs, PRINCIPAL)).rejects.toThrow(
      /owned by the outlook stack/,
    );
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — schedule_email", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString(); // +1 day
  const past = new Date(Date.now() - 86_400_000).toISOString(); // -1 day
  const baseArgs = (sendAt: string, extra: Record<string, unknown> = {}) => ({
    from: "info@aquavoy.com",
    to: "client@example.com",
    subject: "Reminder",
    body: "Body",
    sendAt,
    ...extra,
  });

  function scheduledRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "sched-1",
      fromEmail: "info@aquavoy.com",
      toEmail: "client@example.com",
      subject: "Reminder",
      body: "Body",
      scheduledAt: future,
      status: "pending",
      sentAt: null,
      error: null,
      createdBy: PRINCIPAL,
      createdAt: "2026-06-20T00:00:00.000Z",
      recurrence: "none",
      recurrenceUntil: null,
      ...overrides,
    } as Awaited<ReturnType<typeof scheduleEmail>>;
  }

  it("happy path: schedules a one-shot send, owns it by principal, and captures scheduledId for undo", async () => {
    scheduleEmailMock.mockResolvedValue(scheduledRow());

    const out = await executeConfirmedAction("schedule_email", baseArgs(future), PRINCIPAL);

    expect(scheduleEmailMock).toHaveBeenCalledTimes(1);
    // Owned by the verified principal (never a model value), default recurrence 'none'.
    expect(scheduleEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: PRINCIPAL, recurrence: "none" }),
    );
    expect(out.undo_data).toEqual({ scheduledId: "sched-1" });
    expect((out.result as { scheduled: boolean }).scheduled).toBe(true);
  });

  it("rejects a sendAt in the past, without scheduling", async () => {
    await expect(
      executeConfirmedAction("schedule_email", baseArgs(past), PRINCIPAL),
    ).rejects.toThrow("sendAt must be in the future");
    expect(scheduleEmailMock).not.toHaveBeenCalled();
  });

  it("rejects a non-ISO sendAt as invalid", async () => {
    await expect(
      executeConfirmedAction("schedule_email", baseArgs("not-a-date"), PRINCIPAL),
    ).rejects.toThrow("sendAt must be a valid ISO-8601 datetime");
    expect(scheduleEmailMock).not.toHaveBeenCalled();
  });

  it("passes a valid recurrence through, and ignores an unknown recurrence (falls back to 'none')", async () => {
    scheduleEmailMock.mockResolvedValue(scheduledRow({ recurrence: "monthly" }));
    await executeConfirmedAction(
      "schedule_email",
      baseArgs(future, { recurrence: "monthly" }),
      PRINCIPAL,
    );
    expect(scheduleEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: "monthly" }),
    );

    scheduleEmailMock.mockClear();
    scheduleEmailMock.mockResolvedValue(scheduledRow());
    await executeConfirmedAction(
      "schedule_email",
      baseArgs(future, { recurrence: "fortnightly" }),
      PRINCIPAL,
    );
    // Unknown value is not trusted — coerced to the one-shot default.
    expect(scheduleEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: "none" }),
    );
  });

  it("rejects when a required field (body) is missing", async () => {
    await expect(
      executeConfirmedAction(
        "schedule_email",
        { from: "a@b.com", to: "c@d.com", subject: "s", body: "", sendAt: future },
        PRINCIPAL,
      ),
    ).rejects.toThrow("from, to, subject, body, and sendAt are all required");
    expect(scheduleEmailMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — record_finance_entry", () => {
  const baseArgs = (extra: Record<string, unknown> = {}) => ({
    direction: "expense",
    company: "Acme Ltd",
    amount: 120.5,
    currency: "EUR",
    ...extra,
  });

  it("happy path: books the entry, attributes it to the principal, and captures the entry id for undo", async () => {
    recordFinanceEntryMock.mockResolvedValue({ id: "fin-1" });

    const out = await executeConfirmedAction("record_finance_entry", baseArgs(), PRINCIPAL);

    expect(recordFinanceEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        company: "Acme Ltd",
        direction: "expense",
        amount: 120.5,
        createdBy: PRINCIPAL,
      }),
    );
    expect(out.undo_data).toEqual({ financeEntryId: "fin-1" });
    expect(out.result).toEqual({
      recorded: true,
      id: "fin-1",
      company: "Acme Ltd",
      direction: "expense",
      amount: 120.5,
    });
  });

  it("rejects a direction that is neither 'expense' nor 'income'", async () => {
    await expect(
      executeConfirmedAction("record_finance_entry", baseArgs({ direction: "transfer" }), PRINCIPAL),
    ).rejects.toThrow('direction must be "expense" or "income"');
    expect(recordFinanceEntryMock).not.toHaveBeenCalled();
  });

  it("rejects a missing company", async () => {
    await expect(
      executeConfirmedAction("record_finance_entry", baseArgs({ company: "  " }), PRINCIPAL),
    ).rejects.toThrow("company is required");
    expect(recordFinanceEntryMock).not.toHaveBeenCalled();
  });

  it("rejects amount <= 0", async () => {
    await expect(
      executeConfirmedAction("record_finance_entry", baseArgs({ amount: 0 }), PRINCIPAL),
    ).rejects.toThrow("amount must be a finite number greater than 0");
    await expect(
      executeConfirmedAction("record_finance_entry", baseArgs({ amount: -5 }), PRINCIPAL),
    ).rejects.toThrow("amount must be a finite number greater than 0");
    expect(recordFinanceEntryMock).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount", async () => {
    await expect(
      executeConfirmedAction("record_finance_entry", baseArgs({ amount: "abc" }), PRINCIPAL),
    ).rejects.toThrow("amount must be a finite number greater than 0");
    expect(recordFinanceEntryMock).not.toHaveBeenCalled();
  });

  it("accepts income direction and a numeric-string amount that coerces cleanly", async () => {
    recordFinanceEntryMock.mockResolvedValue({ id: "fin-2" });
    const out = await executeConfirmedAction(
      "record_finance_entry",
      baseArgs({ direction: "income", amount: "200" }),
      PRINCIPAL,
    );
    expect(recordFinanceEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "income", amount: 200 }),
    );
    expect((out.result as { recorded: boolean }).recorded).toBe(true);
  });
});

describe("executeConfirmedAction — batch_move_to_trash / batch_move_to_folder", () => {
  const baseArgs = (extra: Record<string, unknown> = {}) => ({
    mailbox: "info@aquavoy.com",
    sourceFolderPath: "INBOX",
    destFolderPath: "Trash",
    uids: [101, 102],
    ...extra,
  });

  it("happy path: moves the staged UIDs and populates undo_data (uidMap + messageIds)", async () => {
    moveMessagesMock.mockResolvedValue({
      movedCount: 2,
      destFolderPath: "Trash",
      uidMap: { 101: 5001, 102: 5002 },
    });

    const out = await executeConfirmedAction(
      "batch_move_to_trash",
      baseArgs({ messageIds: { 101: "<a@x>", 102: "<b@x>" } }),
      PRINCIPAL,
    );

    expect(moveMessagesMock).toHaveBeenCalledWith("info@aquavoy.com", "INBOX", [101, 102], "Trash");
    expect(out.result).toEqual({ moved: 2, destFolderPath: "Trash" });
    expect(out.undo_data).toEqual({
      mailbox: "info@aquavoy.com",
      sourceFolderPath: "INBOX",
      destFolderPath: "Trash",
      uidMap: { 101: 5001, 102: 5002 },
      messageIds: { 101: "<a@x>", 102: "<b@x>" },
    });
  });

  it("batch_move_to_folder shares the same path (filters non-numeric uids)", async () => {
    moveMessagesMock.mockResolvedValue({ movedCount: 1, destFolderPath: "Archive", uidMap: {} });

    const out = await executeConfirmedAction(
      "batch_move_to_folder",
      baseArgs({ destFolderPath: "Archive", uids: [201, "bad", null, NaN] }),
      PRINCIPAL,
    );

    // Only the finite numeric UID survives the filter.
    expect(moveMessagesMock).toHaveBeenCalledWith("info@aquavoy.com", "INBOX", [201], "Archive");
    // No messageIds supplied → undo_data carries an empty map, not undefined.
    expect((out.undo_data as { messageIds: unknown }).messageIds).toEqual({});
  });

  it("rejects when mailbox/source/dest folder paths are missing, without moving", async () => {
    await expect(
      executeConfirmedAction("batch_move_to_trash", baseArgs({ mailbox: "" }), PRINCIPAL),
    ).rejects.toThrow("mailbox, sourceFolderPath, and destFolderPath are required");
    expect(moveMessagesMock).not.toHaveBeenCalled();
  });

  it("rejects when no valid UIDs are staged to move", async () => {
    await expect(
      executeConfirmedAction("batch_move_to_trash", baseArgs({ uids: [] }), PRINCIPAL),
    ).rejects.toThrow("no message UIDs staged to move");
    expect(moveMessagesMock).not.toHaveBeenCalled();
  });
});

describe("executeConfirmedAction — unknown tool", () => {
  it("throws for a tool that is not a confirmable destructive action", async () => {
    await expect(executeConfirmedAction("teleport", {}, PRINCIPAL)).rejects.toThrow(
      "Not a confirmable destructive action: teleport",
    );
  });
});
