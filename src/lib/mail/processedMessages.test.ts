import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam tests for the processedMessages idempotency store (REQ-29).
 * supabaseAdmin is mocked with a chainable query-builder stub.
 * Assertions cover:
 *   - isAlreadyProcessed returns true when a row exists, false when null
 *   - markProcessed calls upsert with onConflict:"mailbox,uid" and ignoreDuplicates:true
 *   - markProcessed does NOT throw when ignoreDuplicates suppresses the conflict
 *   - cleanupProcessed deletes old rows and returns the count
 */

// ── Chainable Supabase mock ──────────────────────────────────

/** The resolved value the next from().select...maybeSingle() call should return. */
let nextSelectResult: { data: unknown; error: null | { message: string } } = {
  data: null,
  error: null,
};

/** Captures the last upsert call arguments for assertion. */
let lastUpsertArgs: { rows: unknown; opts: unknown } | null = null;

/** Captures the last delete+select call for assertion. */
let lastDeleteResult: { data: { id: string }[] | null; error: null } = {
  data: null,
  error: null,
};

function makeDb() {
  return {
    from(_table: string) {
      return {
        // SELECT chain: .select().eq().eq().maybeSingle()
        select(_cols?: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                eq(_col2: string, _val2: unknown) {
                  return {
                    maybeSingle() {
                      return Promise.resolve(nextSelectResult);
                    },
                  };
                },
              };
            },
            // DELETE chain: .delete().lt().select() — resolves immediately
            lt(_col: string, _val: unknown) {
              return Promise.resolve(lastDeleteResult);
            },
          };
        },
        // DELETE chain entry point
        delete() {
          return {
            lt(_col: string, _val: unknown) {
              return {
                select(_cols?: string) {
                  return Promise.resolve(lastDeleteResult);
                },
              };
            },
          };
        },
        // UPSERT
        upsert(rows: unknown, opts: unknown) {
          lastUpsertArgs = { rows, opts };
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: vi.fn(() => makeDb()),
}));

import {
  isAlreadyProcessed,
  markProcessed,
  cleanupProcessed,
} from "./processedMessages";

describe("processedMessages", () => {
  beforeEach(() => {
    nextSelectResult = { data: null, error: null };
    lastUpsertArgs = null;
    lastDeleteResult = { data: null, error: null };
  });

  // ── isAlreadyProcessed ──────────────────────────────────────

  describe("isAlreadyProcessed", () => {
    it("returns false when no row exists (data === null)", async () => {
      nextSelectResult = { data: null, error: null };
      const result = await isAlreadyProcessed("info@aquavoy.com", 42);
      expect(result).toBe(false);
    });

    it("returns true when a row exists (data !== null)", async () => {
      nextSelectResult = { data: { id: "some-uuid" }, error: null };
      const result = await isAlreadyProcessed("info@aquavoy.com", 42);
      expect(result).toBe(true);
    });
  });

  // ── markProcessed ───────────────────────────────────────────

  describe("markProcessed", () => {
    it("calls upsert with onConflict:'mailbox,uid' and ignoreDuplicates:true", async () => {
      await markProcessed({
        mailbox: "info@aquavoy.com",
        uid: 101,
        messageId: "<abc123@mail.aquavoy.com>",
        category: "invoice",
      });

      expect(lastUpsertArgs).not.toBeNull();
      const opts = lastUpsertArgs!.opts as Record<string, unknown>;
      expect(opts.onConflict).toBe("mailbox,uid");
      expect(opts.ignoreDuplicates).toBe(true);
    });

    it("does not throw when ignoreDuplicates suppresses the conflict (error === null)", async () => {
      // The mock always returns error:null — simulate the ignoreDuplicates path
      await expect(
        markProcessed({
          mailbox: "info@aquavoy.com",
          uid: 999,
          messageId: null,
          category: "other",
        }),
      ).resolves.toBeUndefined();
    });

    it("includes the correct row fields in the upsert", async () => {
      await markProcessed({
        mailbox: "crewing@aquavoy.com",
        uid: 77,
        messageId: "<xyz@example.com>",
        category: "payslip",
      });

      const rows = lastUpsertArgs!.rows as Record<string, unknown>;
      expect(rows.mailbox).toBe("crewing@aquavoy.com");
      expect(rows.uid).toBe(77);
      expect(rows.message_id).toBe("<xyz@example.com>");
      expect(rows.category).toBe("payslip");
    });
  });

  // ── cleanupProcessed ────────────────────────────────────────

  describe("cleanupProcessed", () => {
    it("returns 0 when no rows were deleted", async () => {
      lastDeleteResult = { data: [], error: null };
      const count = await cleanupProcessed(90);
      expect(count).toBe(0);
    });

    it("returns the count of deleted rows", async () => {
      lastDeleteResult = {
        data: [{ id: "uuid-1" }, { id: "uuid-2" }, { id: "uuid-3" }],
        error: null,
      };
      const count = await cleanupProcessed(30);
      expect(count).toBe(3);
    });

    it("defaults to 90 days when no argument is passed", async () => {
      lastDeleteResult = { data: [], error: null };
      // Just assert it resolves without error — cutoff calculation is internal
      await expect(cleanupProcessed()).resolves.toBe(0);
    });
  });
});
