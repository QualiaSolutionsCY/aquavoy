import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Seam test for the memory-sweep cron route. extractFacts and the Supabase
 * client are mocked — no LLM, no DB. Asserts:
 *   - a request without the matching CRON_SECRET bearer is rejected 401 and
 *     extractFacts is never called (auth guard).
 *   - with the correct bearer, a CLOSED straggler session is processed once and
 *     the principal's LATEST (open) session is skipped.
 */

const { extractFactsMock, fromMock } = vi.hoisted(() => ({
  extractFactsMock: vi.fn(async () => 1),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/agents/memoryStore", () => ({ extractFacts: extractFactsMock }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: fromMock }),
}));

import { GET } from "./route";

const SECRET = "test-cron-secret";

function req(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("https://app.test/api/memory/sweep", { headers });
}

beforeEach(() => {
  extractFactsMock.mockClear();
  fromMock.mockReset();
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/memory/sweep", () => {
  it("rejects without the matching bearer and never extracts", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(extractFactsMock).not.toHaveBeenCalled();
  });

  it("rejects when no authorization header is present", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(extractFactsMock).not.toHaveBeenCalled();
  });

  it("processes a closed straggler and skips the principal's latest session", async () => {
    // chat_messages: 'old' session (closed) is older; 'new' session is latest.
    const chatRows = [
      { principal: "Wency", session_id: "old", role: "user", content: "agreed EUR 40/ton", created_at: "2026-06-01T10:00:00.000Z" },
      { principal: "Wency", session_id: "new", role: "user", content: "hello again", created_at: "2026-06-15T10:00:00.000Z" },
    ];

    // First .from("chat_messages") → select().order().limit() resolves to all rows.
    const chatChain = {
      select: vi.fn(() => chatChain),
      order: vi.fn(() => chatChain),
      limit: vi.fn(async () => ({ data: chatRows, error: null })),
    };

    // .from("memory_facts") → select().eq().limit() → empty (no facts yet).
    const factsChain = {
      select: vi.fn(() => factsChain),
      eq: vi.fn(() => factsChain),
      limit: vi.fn(async () => ({ data: [], error: null })),
    };

    fromMock.mockImplementation((table: string) =>
      table === "chat_messages" ? chatChain : factsChain,
    );

    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ processed: 1, failed: 0 });
    // Only the closed 'old' session is extracted; 'new' (latest) is skipped.
    expect(extractFactsMock).toHaveBeenCalledTimes(1);
    expect(extractFactsMock).toHaveBeenCalledWith(
      "Wency",
      "old",
      [{ role: "user", content: "agreed EUR 40/ton" }],
    );
  });
});
