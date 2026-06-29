import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Orchestration + idempotency tests for inboxScan (REQ-29, Task 3).
 *
 * All four collaborators are mocked:
 *   - @/lib/mail/imap          — listEmails, readEmail
 *   - ./inboxClassifier        — classifyMessage
 *   - ./processedMessages      — markProcessed, isAlreadyProcessed
 *   - @/lib/agents/pendingActions — stagePendingAction
 *
 * Tests cover:
 *   (a) idempotency     — already-processed UID → classify+stage NOT called, skipped++
 *   (b) ordering        — markProcessed called BEFORE stagePendingAction
 *   (c) one-per-email   — creditNote with attachments → exactly ONE stage call
 *   (d) principal       — every stage call uses principal "Wency"
 *   (e) resilience      — classifyMessage throws → errors++, loop continues
 */

// ── vi.hoisted stubs ───────────────────────────────────────────────────────

const {
  listEmailsMock,
  readEmailMock,
  classifyMessageMock,
  markProcessedMock,
  isAlreadyProcessedMock,
  stagePendingActionMock,
} = vi.hoisted(() => ({
  listEmailsMock: vi.fn(),
  readEmailMock: vi.fn(),
  classifyMessageMock: vi.fn(),
  markProcessedMock: vi.fn(),
  isAlreadyProcessedMock: vi.fn(),
  stagePendingActionMock: vi.fn(),
}));

vi.mock("@/lib/mail/imap", () => ({
  listEmails: listEmailsMock,
  readEmail: readEmailMock,
}));

vi.mock("./inboxClassifier", () => ({
  classifyMessage: classifyMessageMock,
}));

vi.mock("./processedMessages", () => ({
  markProcessed: markProcessedMock,
  isAlreadyProcessed: isAlreadyProcessedMock,
}));

vi.mock("@/lib/agents/pendingActions", () => ({
  stagePendingAction: stagePendingActionMock,
}));

import { runInboxScan } from "./inboxScan";

// ── Shared fixtures ────────────────────────────────────────────────────────

/** A minimal EmailSummary stub (uid, from, subject are all we need). */
function makeEmailSummary(uid: number, from = "supplier@example.com", subject = "Invoice #42") {
  return { uid, from, subject, to: "", date: null, seen: null };
}

/** A minimal EmailDetail stub. */
function makeEmailDetail(uid: number, body = "email body", attachmentCount = 0) {
  return {
    uid,
    from: "supplier@example.com",
    to: "",
    cc: "",
    date: null,
    subject: "Invoice #42",
    body,
    attachments: Array.from({ length: attachmentCount }, (_, i) => ({
      filename: `attachment-${i}.pdf`,
      contentType: "application/pdf",
      size: 1024,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: both mailboxes return empty arrays (safe baseline)
  listEmailsMock.mockResolvedValue([]);
  readEmailMock.mockResolvedValue(makeEmailDetail(1));
  classifyMessageMock.mockResolvedValue("routine");
  isAlreadyProcessedMock.mockResolvedValue(false);
  markProcessedMock.mockResolvedValue(undefined);
  stagePendingActionMock.mockResolvedValue({ id: "fake-uuid" });
});

// ── (a) Idempotency ────────────────────────────────────────────────────────

describe("(a) idempotency — already-processed UID is skipped", () => {
  it("does NOT call classifyMessage or stagePendingAction for an already-processed UID, and increments skipped", async () => {
    // Only admin@ has a message; mark it as already processed
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(101)]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(true);

    const summary = await runInboxScan();

    expect(classifyMessageMock).not.toHaveBeenCalled();
    expect(stagePendingActionMock).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.staged).toBe(0);
    expect(summary.scanned).toBe(0);
  });

  it("processes a fresh UID (isAlreadyProcessed = false) normally", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(202)]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("routine");

    const summary = await runInboxScan();

    expect(classifyMessageMock).toHaveBeenCalledTimes(1);
    expect(summary.scanned).toBe(1);
    expect(summary.skipped).toBe(0);
  });
});

// ── (b) Ordering: markProcessed BEFORE stagePendingAction ─────────────────

describe("(b) ordering — markProcessed is called before stagePendingAction", () => {
  it("invokes markProcessed before stagePendingAction for a financial message", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(303)]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("invoice");
    readEmailMock.mockResolvedValue(makeEmailDetail(303));

    await runInboxScan();

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(stagePendingActionMock).toHaveBeenCalledTimes(1);

    // Compare the mock's invocationCallOrder: markProcessed must have a lower
    // call-order index than stagePendingAction (called first in the run).
    const markOrder = markProcessedMock.mock.invocationCallOrder[0];
    const stageOrder = stagePendingActionMock.mock.invocationCallOrder[0];
    expect(markOrder).toBeLessThan(stageOrder);
  });
});

// ── (c) One staged action per email ───────────────────────────────────────

describe("(c) one-per-email — creditNote with attachments produces exactly ONE stage call", () => {
  it("stages only record_finance_entry even when the message has attachments", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(404, "billing@gefo.example", "Credit Note CN-2026-047")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("creditNote");
    // 2 attachments — must NOT trigger a second stagePendingAction
    readEmailMock.mockResolvedValue(makeEmailDetail(404, "credit note body", 2));

    const summary = await runInboxScan();

    expect(stagePendingActionMock).toHaveBeenCalledTimes(1);
    expect(summary.staged).toBe(1);

    const call = stagePendingActionMock.mock.calls[0][0];
    expect(call.tool).toBe("record_finance_entry");
  });
});

// ── (d) Principal ──────────────────────────────────────────────────────────

describe("(d) principal — every stagePendingAction call uses principal 'Wency'", () => {
  it("uses Wency as principal for an invoice", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(505)]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("invoice");
    readEmailMock.mockResolvedValue(makeEmailDetail(505));

    await runInboxScan();

    for (const call of stagePendingActionMock.mock.calls) {
      expect(call[0].principal).toBe("Wency");
    }
  });

  it("uses Wency as principal for a voyageSummary", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "rice@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(606, "ops@shipping.example", "Voyage AQ-2026-003 Summary")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("voyageSummary");
    readEmailMock.mockResolvedValue(makeEmailDetail(606));

    await runInboxScan();

    for (const call of stagePendingActionMock.mock.calls) {
      expect(call[0].principal).toBe("Wency");
    }
  });
});

// ── (e) Resilience ─────────────────────────────────────────────────────────

describe("(e) resilience — a classify throw increments errors and does not abort the loop", () => {
  it("counts errors and continues processing the next message", async () => {
    const emailA = makeEmailSummary(701, "a@example.com", "First Message");
    const emailB = makeEmailSummary(702, "b@example.com", "Second Message");

    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([emailA, emailB]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);

    // emailA classify throws; emailB classifies as invoice
    classifyMessageMock
      .mockRejectedValueOnce(new Error("LLM timeout"))
      .mockResolvedValueOnce("invoice");

    readEmailMock.mockResolvedValue(makeEmailDetail(702));

    const summary = await runInboxScan();

    expect(summary.errors).toBe(1);
    expect(summary.staged).toBe(1); // emailB was staged
    expect(stagePendingActionMock).toHaveBeenCalledTimes(1);
  });

  it("continues to the next mailbox when an error occurs in the first", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(801)]);
      }
      if (mailbox === "rice@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(802, "ops@shipping.example", "Voyage Summary")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);

    classifyMessageMock
      .mockRejectedValueOnce(new Error("classify failure"))
      .mockResolvedValueOnce("voyageSummary");

    readEmailMock.mockResolvedValue(makeEmailDetail(802));

    const summary = await runInboxScan();

    expect(summary.errors).toBe(1);
    expect(summary.staged).toBe(1);
    expect(stagePendingActionMock).toHaveBeenCalledTimes(1);
    expect(stagePendingActionMock.mock.calls[0][0].tool).toBe("record_voyage_entry");
  });
});

// ── Tool mapping ───────────────────────────────────────────────────────────

describe("tool mapping", () => {
  it("stages record_finance_entry with direction=income for creditNote", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(901, "billing@gefo.example", "Credit Note CN-001")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("creditNote");
    readEmailMock.mockResolvedValue(makeEmailDetail(901));

    await runInboxScan();

    const call = stagePendingActionMock.mock.calls[0][0];
    expect(call.tool).toBe("record_finance_entry");
    expect(call.args.direction).toBe("income");
  });

  it("stages record_finance_entry with direction=expense for invoice", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(902, "vendor@example.com", "Invoice INV-100")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("invoice");
    readEmailMock.mockResolvedValue(makeEmailDetail(902));

    await runInboxScan();

    const call = stagePendingActionMock.mock.calls[0][0];
    expect(call.tool).toBe("record_finance_entry");
    expect(call.args.direction).toBe("expense");
  });

  it("stages record_voyage_entry for voyageSummary", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "rice@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(903, "ops@shipping.example", "Voyage AQ-2026-010 Summary")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    classifyMessageMock.mockResolvedValue("voyageSummary");
    readEmailMock.mockResolvedValue(makeEmailDetail(903));

    await runInboxScan();

    const call = stagePendingActionMock.mock.calls[0][0];
    expect(call.tool).toBe("record_voyage_entry");
    expect(call.args.sourceRef).toBe("Voyage AQ-2026-010 Summary");
  });

  it("does NOT stage for non-financial categories (important, routine, spam)", async () => {
    for (const cat of ["important", "routine", "spam"] as const) {
      vi.clearAllMocks();
      listEmailsMock.mockImplementation((mailbox: string) => {
        if (mailbox === "admin@aquavoy.com") {
          return Promise.resolve([makeEmailSummary(1000, "x@example.com", "Some email")]);
        }
        return Promise.resolve([]);
      });
      isAlreadyProcessedMock.mockResolvedValue(false);
      classifyMessageMock.mockResolvedValue(cat);
      readEmailMock.mockResolvedValue(makeEmailDetail(1000));

      const summary = await runInboxScan();

      expect(stagePendingActionMock).not.toHaveBeenCalled();
      expect(summary.staged).toBe(0);
      expect(summary.scanned).toBe(1);
    }
  });
});

// ── ScanSummary shape ──────────────────────────────────────────────────────

describe("ScanSummary shape", () => {
  it("returns zero-value summary when both mailboxes are empty", async () => {
    listEmailsMock.mockResolvedValue([]);

    const summary = await runInboxScan();

    expect(summary.scanned).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.staged).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.byMailbox["admin@aquavoy.com"]).toEqual({ scanned: 0, staged: 0 });
    expect(summary.byMailbox["rice@aquavoy.com"]).toEqual({ scanned: 0, staged: 0 });
  });

  it("byMailbox tracks per-mailbox scanned/staged independently", async () => {
    listEmailsMock.mockImplementation((mailbox: string) => {
      if (mailbox === "admin@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(1101), makeEmailSummary(1102)]);
      }
      if (mailbox === "rice@aquavoy.com") {
        return Promise.resolve([makeEmailSummary(1201, "ops@shipping.example", "Voyage Summary")]);
      }
      return Promise.resolve([]);
    });
    isAlreadyProcessedMock.mockResolvedValue(false);
    // admin@ — first invoice, second routine
    // rice@ — voyageSummary
    classifyMessageMock
      .mockResolvedValueOnce("invoice")
      .mockResolvedValueOnce("routine")
      .mockResolvedValueOnce("voyageSummary");
    readEmailMock.mockResolvedValue(makeEmailDetail(0));

    const summary = await runInboxScan();

    expect(summary.byMailbox["admin@aquavoy.com"].scanned).toBe(2);
    expect(summary.byMailbox["admin@aquavoy.com"].staged).toBe(1);
    expect(summary.byMailbox["rice@aquavoy.com"].scanned).toBe(1);
    expect(summary.byMailbox["rice@aquavoy.com"].staged).toBe(1);
    expect(summary.staged).toBe(2);
    expect(summary.scanned).toBe(3);
  });
});
