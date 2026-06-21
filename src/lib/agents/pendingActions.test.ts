import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the pending-action confirm/cancel lifecycle (ADR-003). Supabase
 * (supabaseAdmin) and the side-effect runner (executeConfirmedAction) are mocked
 * so the lifecycle logic is tested in isolation — no DB, no real mutation. The
 * load-bearing properties under test:
 *   - confirmAction claims FIRST with a status-guarded UPDATE; when the claim
 *     hits 0 rows (concurrent / already-resolved) the side-effect is NOT run
 *     again (idempotent), and the current state is surfaced via getPendingAction.
 *   - confirmAction runs executeConfirmedAction exactly once on a winning claim
 *     and records result + undo_data.
 *   - a side-effect throw flips the row to 'failed' with the error captured.
 *   - cancelAction sets 'cancelled' on the happy path and is idempotent when the
 *     guarded UPDATE hits 0 rows.
 *   - every query is scoped to the passed principal (REQ-3), never a model value.
 */

// ── Programmable, chainable Supabase query-builder mock ───────
// confirmAction issues, in order:
//   1. claim:   .from(T).update({status:confirmed,...}).eq(id).eq(principal).eq(status).select().maybeSingle()
//   2. result:  .from(T).update({result,undo_data}).eq(id).select().maybeSingle()
//      or fail: .from(T).update({status:failed,result}).eq(id).select().maybeSingle()
// getPendingAction issues:
//   .from(T).select().eq(id).eq(principal).maybeSingle()
// cancelAction issues:
//   getPendingAction(...) then .from(T).update({status:cancelled,...}).eq(id).eq(principal).eq(status).select().maybeSingle()
//
// Each builder records the operation kind, the patch, and every .eq() call, then
// resolves with a result pulled FIFO from the queued responses for its kind.

type OpKind = "select" | "update";

interface RecordedOp {
  kind: OpKind;
  patch: Record<string, unknown> | null;
  eqs: Array<{ col: string; val: unknown }>;
}

const recorded: RecordedOp[] = [];
// FIFO queues of `{ data, error }` keyed by op kind.
const selectResults: Array<{ data: unknown; error: unknown }> = [];
const updateResults: Array<{ data: unknown; error: unknown }> = [];

function nextResult(kind: OpKind) {
  const queue = kind === "select" ? selectResults : updateResults;
  return queue.shift() ?? { data: null, error: null };
}

function makeBuilder(kind: OpKind, patch: Record<string, unknown> | null) {
  const op: RecordedOp = { kind, patch, eqs: [] };
  recorded.push(op);
  const builder = {
    eq(col: string, val: unknown) {
      op.eqs.push({ col, val });
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(nextResult(kind));
    },
    single() {
      return Promise.resolve(nextResult(kind));
    },
  };
  return builder;
}

function makeDb() {
  return {
    from() {
      return {
        select() {
          return makeBuilder("select", null);
        },
        update(patch: Record<string, unknown>) {
          return makeBuilder("update", patch);
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: vi.fn(() => makeDb()),
}));

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));
vi.mock("@/lib/agents/executeConfirmedAction", () => ({
  executeConfirmedAction: executeMock,
}));

import { confirmAction, cancelAction } from "./pendingActions";

/** A pending_actions DB row (snake_case, as Supabase returns it). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "pa-1",
    principal: "Wency",
    tool: "send_email",
    args: { to: "x@example.com" },
    summary: "Send email to x@example.com",
    status: "pending",
    undo_data: null,
    result: null,
    created_at: "2026-06-17T10:00:00.000Z",
    resolved_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  recorded.length = 0;
  selectResults.length = 0;
  updateResults.length = 0;
  executeMock.mockReset();
});

describe("pendingActions confirmAction — claim-first idempotency", () => {
  it("runs the side-effect once and records result + undo_data on a winning claim", async () => {
    // 1) claim UPDATE wins (returns the now-confirmed row)
    updateResults.push({ data: row({ status: "confirmed" }), error: null });
    // executeConfirmedAction succeeds
    executeMock.mockResolvedValue({
      result: { sent: true },
      undo_data: { scheduledId: "s-1" },
    });
    // 2) result UPDATE returns the final row
    updateResults.push({
      data: row({ status: "confirmed", result: { sent: true }, undo_data: { scheduledId: "s-1" } }),
      error: null,
    });

    const out = await confirmAction("pa-1", "Wency");

    // Side-effect ran EXACTLY once, with the claimed tool/args + the principal.
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock).toHaveBeenCalledWith("send_email", { to: "x@example.com" }, "Wency");
    // The recorded outcome is surfaced.
    expect(out?.status).toBe("confirmed");
    expect(out?.result).toEqual({ sent: true });
    expect(out?.undoData).toEqual({ scheduledId: "s-1" });

    // The result-recording UPDATE carried both result and undo_data.
    const resultUpdate = recorded.find(
      (o) => o.kind === "update" && o.patch?.result !== undefined && o.patch?.undo_data !== undefined,
    );
    expect(resultUpdate?.patch?.result).toEqual({ sent: true });
    expect(resultUpdate?.patch?.undo_data).toEqual({ scheduledId: "s-1" });
  });

  it("is idempotent: a lost claim (0 rows) does NOT run the side-effect again and surfaces current state", async () => {
    // Claim UPDATE hits 0 rows — another confirm already won (or it is resolved).
    updateResults.push({ data: null, error: null });
    // Fallback getPendingAction returns the already-confirmed row.
    selectResults.push({ data: row({ status: "confirmed", result: { sent: true } }), error: null });

    const out = await confirmAction("pa-1", "Wency");

    // The whole point: no second side-effect on a re-confirm / concurrent confirm.
    expect(executeMock).not.toHaveBeenCalled();
    // The existing action is returned via the fallback read.
    expect(out?.status).toBe("confirmed");
    expect(out?.id).toBe("pa-1");
  });

  it("returns null when a lost claim resolves to no row for the principal", async () => {
    updateResults.push({ data: null, error: null }); // claim: 0 rows
    selectResults.push({ data: null, error: null }); // fallback getPendingAction: not found / wrong principal

    const out = await confirmAction("missing-id", "Wency");

    expect(out).toBeNull();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("marks the row 'failed' with the error captured, then surfaces the failed row, when the side-effect throws", async () => {
    updateResults.push({ data: row({ status: "confirmed" }), error: null }); // claim wins
    executeMock.mockRejectedValue(new Error("550 mailbox unavailable"));
    // failure-recording UPDATE returns the failed row
    updateResults.push({
      data: row({ status: "failed", result: { error: "550 mailbox unavailable" } }),
      error: null,
    });

    const out = await confirmAction("pa-1", "Wency");

    expect(executeMock).toHaveBeenCalledTimes(1);
    // The contract: it does NOT re-raise — it records 'failed' and returns the row.
    expect(out?.status).toBe("failed");
    expect(out?.result).toEqual({ error: "550 mailbox unavailable" });

    // The failure UPDATE set status:failed and captured the error message.
    const failUpdate = recorded.find((o) => o.kind === "update" && o.patch?.status === "failed");
    expect(failUpdate?.patch?.status).toBe("failed");
    expect(failUpdate?.patch?.result).toEqual({ error: "550 mailbox unavailable" });
  });

  it("propagates a non-Error throw as a generic 'Action failed' message", async () => {
    updateResults.push({ data: row({ status: "confirmed" }), error: null }); // claim wins
    executeMock.mockRejectedValue("a bare string, not an Error");
    updateResults.push({
      data: row({ status: "failed", result: { error: "Action failed" } }),
      error: null,
    });

    const out = await confirmAction("pa-1", "Wency");

    expect(out?.status).toBe("failed");
    const failUpdate = recorded.find((o) => o.kind === "update" && o.patch?.status === "failed");
    expect(failUpdate?.patch?.result).toEqual({ error: "Action failed" });
  });

  it("scopes the claim to the passed principal — every claim UPDATE filters .eq('principal', principal)", async () => {
    updateResults.push({ data: null, error: null }); // claim: 0 rows (don't care about outcome here)
    selectResults.push({ data: null, error: null }); // fallback

    await confirmAction("pa-1", "Jeanette");

    const claim = recorded.find((o) => o.kind === "update");
    expect(claim?.eqs).toEqual(
      expect.arrayContaining([
        { col: "id", val: "pa-1" },
        { col: "principal", val: "Jeanette" },
        { col: "status", val: "pending" },
      ]),
    );
  });

  it("re-raises when the claim UPDATE itself errors, without running the side-effect", async () => {
    updateResults.push({ data: null, error: { message: "connection reset" } });

    await expect(confirmAction("pa-1", "Wency")).rejects.toThrow("Failed to claim action: connection reset");
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("pendingActions cancelAction — guarded, idempotent", () => {
  it("happy path: sets status='cancelled' and returns the cancelled row", async () => {
    // getPendingAction (existence check) returns a pending row
    selectResults.push({ data: row({ status: "pending" }), error: null });
    // guarded cancel UPDATE wins
    updateResults.push({ data: row({ status: "cancelled", resolved_at: "2026-06-18T00:00:00.000Z" }), error: null });

    const out = await cancelAction("pa-1", "Wency");

    expect(out?.status).toBe("cancelled");
    const cancel = recorded.find((o) => o.kind === "update");
    expect(cancel?.patch?.status).toBe("cancelled");
    // Guarded on pending and scoped to the principal.
    expect(cancel?.eqs).toEqual(
      expect.arrayContaining([
        { col: "id", val: "pa-1" },
        { col: "principal", val: "Wency" },
        { col: "status", val: "pending" },
      ]),
    );
  });

  it("returns null and never issues an UPDATE when the action does not exist for the principal", async () => {
    selectResults.push({ data: null, error: null }); // getPendingAction → not found / wrong principal

    const out = await cancelAction("missing-id", "Wency");

    expect(out).toBeNull();
    // No cancel UPDATE is attempted.
    expect(recorded.some((o) => o.kind === "update")).toBe(false);
  });

  it("is idempotent: an already-resolved cancel (guard hits 0 rows) surfaces the current state, no re-cancel", async () => {
    // existence check: the row exists but is already confirmed
    selectResults.push({ data: row({ status: "confirmed" }), error: null });
    // guarded cancel UPDATE hits 0 rows (status no longer 'pending')
    updateResults.push({ data: null, error: null });
    // fallback getPendingAction surfaces the current (confirmed) state
    selectResults.push({ data: row({ status: "confirmed" }), error: null });

    const out = await cancelAction("pa-1", "Wency");

    // The terminal state is preserved, not overwritten to 'cancelled'.
    expect(out?.status).toBe("confirmed");
  });
});
