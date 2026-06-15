import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the scheduled-email runner. Supabase, the account store, and the
 * SMTP sender are mocked. The critical assertion is per-row isolation: with two
 * due rows where one send fails, runDue() returns {sent:1, failed:1} and the
 * failing row is flagged 'failed' without aborting the batch.
 */

// ── Chainable Supabase query-builder mock ───────────────────
// runDue() reads:  db.from(T).select("*").eq().lte().order().limit()  -> {data,error}
// then per row:    db.from(T).update({...}).eq("id", id)               -> resolves
const dueRows = [
  {
    id: "row-ok",
    from_email: "info@aquavoy.com",
    to_email: "good@example.com",
    subject: "OK",
    body: "body-ok",
    scheduled_at: "2026-06-01T00:00:00Z",
    status: "pending",
    sent_at: null,
    error: null,
    created_by: "agent",
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: "row-fail",
    from_email: "info@aquavoy.com",
    to_email: "bad@example.com",
    subject: "FAIL",
    body: "body-fail",
    scheduled_at: "2026-06-01T00:00:00Z",
    status: "pending",
    sent_at: null,
    error: null,
    created_by: "agent",
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
  loadAccountWithSecretByEmail: vi.fn(async () => ({
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
  })),
}));

vi.mock("@/lib/mail/smtp", () => ({
  sendMail: vi.fn(async ({ to }: { to: string }) => {
    if (to === "bad@example.com") throw new Error("550 mailbox unavailable");
  }),
}));

import { runDue } from "./scheduled";
import { sendMail } from "@/lib/mail/smtp";

describe("mail/scheduled runDue", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    vi.mocked(sendMail).mockClear();
  });

  it("isolates per-row failure: {sent:1, failed:1}", async () => {
    const result = await runDue();
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("marks the good row 'sent' and the failing row 'failed' with an error", async () => {
    await runDue();

    const okUpdate = updateCalls.find((u) => u.id === "row-ok");
    const failUpdate = updateCalls.find((u) => u.id === "row-fail");

    expect(okUpdate?.patch.status).toBe("sent");
    expect(okUpdate?.patch.sent_at).toEqual(expect.any(String));

    expect(failUpdate?.patch.status).toBe("failed");
    expect(String(failUpdate?.patch.error)).toContain("550 mailbox unavailable");
  });
});
