import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Seam test for POST /api/actions/confirm (ADR-003 §4). The session adapter
 * (getPrincipal) and the pendingActions layer (confirmAction) are mocked so the
 * route's HTTP contract is tested in isolation — no cookie crypto, no DB, no
 * side-effect. Asserts:
 *   - 401 when there is no verified principal (AC4).
 *   - 404 when confirmAction returns null — the id belongs to another principal
 *     or does not exist (AC4 / REQ-3 — the caller cannot distinguish the two).
 *   - 200 + confirmed when confirmAction runs the side-effect and returns a
 *     confirmed row (AC3).
 *   - 409 on re-confirm — the row is already resolved (status !== "confirmed"),
 *     so the second confirm is a no-op (AC6).
 */

const { getPrincipalMock, confirmActionMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
  confirmActionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getPrincipal: getPrincipalMock }));
vi.mock("@/lib/agents/pendingActions", () => ({ confirmAction: confirmActionMock }));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/actions/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const confirmedRow = {
  id: "pa-1",
  principal: "Wency",
  tool: "send_email",
  args: { to: "x@example.com" },
  summary: "Send email to x@example.com",
  status: "confirmed",
  undoData: null,
  result: { sent: true },
  createdAt: "2026-06-17T10:00:00.000Z",
  resolvedAt: "2026-06-17T10:00:05.000Z",
};

beforeEach(() => {
  getPrincipalMock.mockReset();
  confirmActionMock.mockReset();
});

describe("POST /api/actions/confirm", () => {
  it("AC4: returns 401 and never confirms when there is no verified principal", async () => {
    getPrincipalMock.mockReturnValue(null);
    const res = await POST(req({ id: "pa-1" }));
    expect(res.status).toBe(401);
    expect(confirmActionMock).not.toHaveBeenCalled();
  });

  it("AC4: returns 404 when confirmAction returns null (id belongs to another principal)", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    confirmActionMock.mockResolvedValue(null);
    const res = await POST(req({ id: "someone-elses-id" }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    // The confirm is scoped to the verified principal, never a model/body value.
    expect(confirmActionMock).toHaveBeenCalledWith("someone-elses-id", "Wency");
  });

  it("AC3: returns 200 + the confirmed action when the side-effect ran", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    confirmActionMock.mockResolvedValue(confirmedRow);
    const res = await POST(req({ id: "pa-1" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.action.status).toBe("confirmed");
    expect(json.data.action.id).toBe("pa-1");
  });

  it("AC6: returns 409 on re-confirm — the row is already resolved (not pending)", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    // The idempotent guard returns the already-resolved row with a non-confirmed
    // status (e.g. it was cancelled, or a prior confirm already settled it).
    confirmActionMock.mockResolvedValue({ ...confirmedRow, status: "cancelled" });
    const res = await POST(req({ id: "pa-1" }));
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("not pending");
  });

  it("returns 400 when the body has no id, without confirming", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(confirmActionMock).not.toHaveBeenCalled();
  });
});
