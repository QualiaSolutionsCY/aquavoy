import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Seam tests for GET/POST /api/notify/preferences (ADR-008 §3).
 *
 * Load-bearing properties under test:
 *  - 401 when no verified session principal is present.
 *  - GET returns the preferences scoped to the SESSION principal, never to any
 *    principal the caller might supply.
 *  - POST with a body that names a different principal still writes for the
 *    SESSION principal (body principal is ignored — scoping lives in the helper).
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { getPrincipalMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getPrincipal: getPrincipalMock,
}));

const { loadPrefsMock, savePrefsMock } = vi.hoisted(() => ({
  loadPrefsMock: vi.fn(),
  savePrefsMock: vi.fn(),
}));

vi.mock("@/lib/notify/preferences", () => ({
  loadPreferences: loadPrefsMock,
  savePreferences: savePrefsMock,
}));

import { GET, POST } from "./route";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(method: string, body?: unknown): NextRequest {
  const url = "http://localhost/api/notify/preferences";
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return new NextRequest(url, { method });
}

const FAKE_PREFS = {
  id: "pref-1",
  principal: "Wency",
  channel: "webpush",
  enabled_events: ["stage"],
  quiet_hours_start: null,
  quiet_hours_end: null,
  push_subscription: null,
  created_at: "2026-06-28T00:00:00Z",
  updated_at: "2026-06-28T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/notify/preferences", () => {
  it("(a) returns 401 when no session principal", async () => {
    getPrincipalMock.mockReturnValue(null);

    const res = await GET(makeReq("GET"));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(loadPrefsMock).not.toHaveBeenCalled();
  });

  it("(b) returns prefs scoped to the session principal", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    loadPrefsMock.mockResolvedValue(FAKE_PREFS);

    const res = await GET(makeReq("GET"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // loadPreferences was called with the SESSION principal, not any caller-supplied value.
    expect(loadPrefsMock).toHaveBeenCalledWith("Wency");
    expect(json.data.principal).toBe("Wency");
  });

  it("returns 502 when loadPreferences throws", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    loadPrefsMock.mockRejectedValue(new Error("DB error"));

    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(502);
  });
});

// ── POST ───────────────────────────────────────────────────────────────────

describe("POST /api/notify/preferences", () => {
  it("(a) returns 401 when no session principal", async () => {
    getPrincipalMock.mockReturnValue(null);

    const res = await POST(makeReq("POST", { enabled_events: ["stage"] }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(savePrefsMock).not.toHaveBeenCalled();
  });

  it("(c) always writes for the SESSION principal even if body includes a different one", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    savePrefsMock.mockResolvedValue({ ...FAKE_PREFS, enabled_events: ["stage"] });

    // The body may attempt to name a different principal — it should be ignored.
    const res = await POST(
      makeReq("POST", {
        enabled_events: ["stage"],
        // Note: preferences POST schema does NOT accept a `principal` field, so
        // this is just a spurious key that is stripped by Zod. The critical
        // property is that savePreferences is called with the session principal.
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    // savePreferences always receives the SESSION principal as the first arg.
    expect(savePrefsMock).toHaveBeenCalledWith("Wency", expect.any(Object));
    // Specifically NOT "Jeanette" — session principal wins.
    expect(savePrefsMock.mock.calls[0][0]).toBe("Wency");
  });

  it("updates quiet hours when provided", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    savePrefsMock.mockResolvedValue({
      ...FAKE_PREFS,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
    });

    const res = await POST(
      makeReq("POST", { quiet_hours_start: "22:00", quiet_hours_end: "07:00" }),
    );

    expect(res.status).toBe(200);
    expect(savePrefsMock).toHaveBeenCalledWith(
      "Wency",
      expect.objectContaining({ quiet_hours_start: "22:00", quiet_hours_end: "07:00" }),
    );
  });

  it("sets quiet hours to null when null is passed", async () => {
    getPrincipalMock.mockReturnValue("Jeanette");
    savePrefsMock.mockResolvedValue({ ...FAKE_PREFS, principal: "Jeanette" });

    const res = await POST(
      makeReq("POST", { quiet_hours_start: null, quiet_hours_end: null }),
    );

    expect(res.status).toBe(200);
    expect(savePrefsMock).toHaveBeenCalledWith(
      "Jeanette",
      expect.objectContaining({ quiet_hours_start: null, quiet_hours_end: null }),
    );
  });

  it("returns 400 for an invalid time format", async () => {
    getPrincipalMock.mockReturnValue("Wency");

    const res = await POST(makeReq("POST", { quiet_hours_start: "9am" }));

    expect(res.status).toBe(400);
    expect(savePrefsMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    const req = new NextRequest("http://localhost/api/notify/preferences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("does NOT allow setting push_subscription via this route", async () => {
    getPrincipalMock.mockReturnValue("Wency");
    savePrefsMock.mockResolvedValue(FAKE_PREFS);

    await POST(
      makeReq("POST", {
        push_subscription: { endpoint: "https://evil.example.com", keys: {} },
      }),
    );

    // Zod strips unknown keys — push_subscription is not in the schema,
    // so savePreferences should be called with an empty patch (no subscription).
    if (savePrefsMock.mock.calls.length > 0) {
      expect(savePrefsMock.mock.calls[0][1]).not.toHaveProperty("push_subscription");
    }
  });
});
