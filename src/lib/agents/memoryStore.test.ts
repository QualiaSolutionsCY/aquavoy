import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the durable memory store. The embedding adapter, the LLM
 * completion seam, and the Supabase client are all mocked — no live call. Covers:
 *   AC1 — paraphrase recall: a fact NEAR the query vector but sharing no keyword
 *         ranks above an unrelated fact (the old ilike path would miss it).
 *   AC2 — deterministic ranking: rankFacts orders by score for fixed inputs.
 *   AC4 — principal isolation: hybridRecall filters .eq("principal", X).
 *   AC5 — idempotent extraction: extractFacts upserts onConflict (session_id,fact).
 */

const { embedTextMock, completeMock, fromMock } = vi.hoisted(() => ({
  embedTextMock: vi.fn(),
  completeMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/embeddings", () => ({ embedText: embedTextMock }));
vi.mock("@/lib/openrouter/client", () => ({ complete: completeMock }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: fromMock }),
}));

import { rankFacts, hybridRecall, extractFacts, type FactCandidate } from "./memoryStore";

/** Build a select-chain stub that resolves to `rows` and records eq() calls. */
function selectChain(rows: unknown[], eqSpy: (col: string, val: unknown) => void) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqSpy(col, val);
    return chain;
  });
  chain.limit = vi.fn(async () => ({ data: rows, error: null }));
  return chain;
}

beforeEach(() => {
  embedTextMock.mockReset();
  completeMock.mockReset();
  fromMock.mockReset();
});

describe("rankFacts (AC2 — deterministic ordering)", () => {
  it("orders candidates by blended score, deterministically", () => {
    const now = Date.parse("2026-06-16T12:00:00.000Z");
    const candidates: FactCandidate[] = [
      {
        id: "low",
        fact: "minor aside about the weather",
        summary: null,
        importance: 1,
        embedding: [0, 1], // orthogonal to query → cosine 0
        created_at: "2026-01-01T00:00:00.000Z", // old → low recency
      },
      {
        id: "high",
        fact: "pricing agreed at forty euro per ton",
        summary: null,
        importance: 5,
        embedding: [1, 0], // identical to query → cosine 1
        created_at: "2026-06-15T00:00:00.000Z", // recent
      },
    ];

    const ranked = rankFacts("pricing", candidates, {
      queryEmbedding: [1, 0],
      nowMs: now,
    });

    expect(ranked.map((r) => r.id)).toEqual(["high", "low"]);
    // Deterministic: same inputs → same order, same scores.
    const again = rankFacts("pricing", candidates, {
      queryEmbedding: [1, 0],
      nowMs: now,
    });
    expect(again.map((r) => r.score)).toEqual(ranked.map((r) => r.score));
  });
});

describe("hybridRecall", () => {
  it("AC1 — surfaces a paraphrased fact (semantic) a keyword match would miss", async () => {
    embedTextMock.mockResolvedValueOnce([1, 0]); // query embedding
    const rows = [
      {
        id: "paraphrase",
        fact: "the agreed rate is EUR 40 per tonne", // shares no >=5-char word with "pricing"
        summary: null,
        importance: 3,
        embedding: [0.98, 0.2], // near the query vector
        created_at: "2026-06-10T00:00:00.000Z",
      },
      {
        id: "unrelated",
        fact: "the vessel name is Aquavoy One",
        summary: null,
        importance: 3,
        embedding: [0, 1], // orthogonal
        created_at: "2026-06-10T00:00:00.000Z",
      },
    ];
    fromMock.mockReturnValueOnce(selectChain(rows, () => {}));

    const out = await hybridRecall("pricing", "Wency", 8);

    expect(out[0].id).toBe("paraphrase");
    // The old ilike("%pricing%") path would have returned nothing here.
  });

  it("AC4 — scopes the query to the principal", async () => {
    embedTextMock.mockResolvedValueOnce([1, 0]);
    const eqCalls: Array<[string, unknown]> = [];
    fromMock.mockReturnValueOnce(
      selectChain([], (col, val) => eqCalls.push([col, val])),
    );

    await hybridRecall("anything", "Wency", 8);

    expect(eqCalls).toContainEqual(["principal", "Wency"]);
  });
});

describe("extractFacts (AC5 — idempotent upsert)", () => {
  it("upserts onConflict (session_id, fact), no duplicate insert on re-run", async () => {
    completeMock.mockResolvedValue(
      JSON.stringify({
        summary: "discussed pricing",
        facts: [{ fact: "rate is EUR 40 per tonne", importance: 5 }],
      }),
    );
    embedTextMock.mockResolvedValue([0.1, 0.2]);

    const upsertSpy = vi.fn(async (_rows: unknown[], _opts: { onConflict: string }) => ({ error: null }));
    fromMock.mockReturnValue({ upsert: upsertSpy });

    const messages = [
      { role: "user", content: "what rate did we agree?" },
      { role: "assistant", content: "EUR 40 per tonne" },
    ];

    const n1 = await extractFacts("Wency", "sess-1", messages);
    const n2 = await extractFacts("Wency", "sess-1", messages);

    expect(n1).toBe(1);
    expect(n2).toBe(1);
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    // Both calls use the (session_id, fact) conflict key — re-run upserts, not duplicates.
    for (const call of upsertSpy.mock.calls) {
      expect(call[1]).toMatchObject({ onConflict: "session_id,fact" });
    }
  });

  it("returns 0 and writes nothing when the model finds no facts", async () => {
    completeMock.mockResolvedValue(JSON.stringify({ summary: "small talk", facts: [] }));
    const upsertSpy = vi.fn(async (_rows: unknown[], _opts: { onConflict: string }) => ({ error: null }));
    fromMock.mockReturnValue({ upsert: upsertSpy });

    const n = await extractFacts("Jeanette", "sess-2", [
      { role: "user", content: "hi" },
    ]);

    expect(n).toBe(0);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
