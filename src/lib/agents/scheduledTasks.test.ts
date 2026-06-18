import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the scheduled-task (reminder) runner. Supabase, the account
 * store, and the SMTP sender are mocked. The critical assertion mirrors the
 * scheduled-email test: with two due rows where one send fails, runDueTasks()
 * returns {sent:1, failed:1} and the failing row is flagged 'failed' WITHOUT
 * aborting the batch. We also assert each reminder is delivered as a self-email
 * (to === mailbox) with the "Reminder: <title>" subject.
 */

// ── Chainable Supabase query-builder mock ───────────────────
// runDueTasks() reads:  db.from(T).select("*").eq().lte().order().limit() -> {data,error}
// then per row:          db.from(T).update({...}).eq("id", id)             -> resolves
const dueRows = [
  {
    id: "row-ok",
    principal: "Wency",
    mailbox: "info@aquavoy.com",
    title: "Call the harbour master",
    notes: "Confirm the berth for next week",
    scheduled_at: "2026-06-01T00:00:00Z",
    status: "pending",
    sent_at: null,
    error: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "row-fail",
    principal: "Wency",
    mailbox: "bad@example.com",
    title: "File the manifest",
    notes: null,
    scheduled_at: "2026-06-01T00:00:00Z",
    status: "pending",
    sent_at: null,
    error: null,
    created_at: "2026-06-01T00:00:00Z",
  },
];

const updateCalls: Array<{ patch: Record<string, unknown>; id: string }> = [];

function makeDb() {
  return {
    from() {
      return {
        // SELECT chain — every link returns `this`; the chain is awaited at .limit()
        select() {
          return this;
        },
        eq() {
          return this;
        },
        lte() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return Promise.resolve({ data: dueRows, error: null });
        },
        // UPDATE chain — update({...}).eq("id", id) resolves; we record it.
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              updateCalls.push({ patch, id });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: vi.fn(() => makeDb()),
}));

vi.mock("@/lib/mail/accounts", () => ({
  loadAccountWithSecretByEmail: vi.fn(async (email: string) => ({
    id: "acct-1",
    email,
    displayName: "Aquavoy",
    smtpHost: "smtp.aquavoy.com",
    smtpPort: 465,
    imapHost: null,
    imapPort: null,
    username: email,
    password: "secret",
    verifiedAt: null,
    mailStack: "imap" as const,
  })),
}));

vi.mock("@/lib/mail/smtp", () => ({
  sendMail: vi.fn(async ({ to }: { to: string }) => {
    if (to === "bad@example.com") throw new Error("550 mailbox unavailable");
  }),
}));

import { runDueTasks } from "./scheduledTasks";
import { sendMail } from "@/lib/mail/smtp";

describe("agents/scheduledTasks runDueTasks", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    vi.mocked(sendMail).mockClear();
  });

  it("isolates per-row failure: {sent:1, failed:1}", async () => {
    const result = await runDueTasks();
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("delivers each reminder as a self-email with a 'Reminder:' subject", async () => {
    await runDueTasks();

    // First (good) row: to === its own mailbox, subject prefixed, body has notes.
    expect(sendMail).toHaveBeenNthCalledWith(1, {
      account: expect.objectContaining({ email: "info@aquavoy.com" }),
      to: "info@aquavoy.com",
      subject: "Reminder: Call the harbour master",
      body: "Call the harbour master\n\nConfirm the berth for next week",
    });
    // Second row has no notes — body is just the title.
    expect(sendMail).toHaveBeenNthCalledWith(2, {
      account: expect.objectContaining({ email: "bad@example.com" }),
      to: "bad@example.com",
      subject: "Reminder: File the manifest",
      body: "File the manifest",
    });
  });

  it("marks the good row 'sent' and the failing row 'failed' with an error", async () => {
    await runDueTasks();

    const okUpdate = updateCalls.find((u) => u.id === "row-ok");
    const failUpdate = updateCalls.find((u) => u.id === "row-fail");

    expect(okUpdate?.patch.status).toBe("sent");
    expect(okUpdate?.patch.sent_at).toEqual(expect.any(String));

    expect(failUpdate?.patch.status).toBe("failed");
    expect(String(failUpdate?.patch.error)).toContain("550 mailbox unavailable");
  });
});
