import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedText } from "./index";

/**
 * Seam test for the embedding adapter. global.fetch is stubbed so no live call
 * reaches the provider. Asserts: the request goes to the embedContent endpoint
 * with the text in content.parts[0].text; the parsed vector is returned; a
 * non-2xx response rejects.
 *
 * EMBEDDING_DIM defaults to 768 (vitest.setup.ts sets GOOGLE_API_KEY only), so
 * the fixture vector is 768-long to pass the dimension guard.
 */

const VEC = Array.from({ length: 768 }, (_, i) => i / 768);

describe("embeddings/embedText", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to :embedContent with the text and returns the parsed vector", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ embedding: { values: VEC } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await embedText("hello world");

    expect(out).toEqual(VEC);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(":embedContent");
    const body = JSON.parse(init.body as string);
    expect(body.content.parts[0].text).toBe("hello world");
    expect(body.output_dimensionality).toBe(768);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "test-google-api-key",
    );
  });

  it("rejects when the provider returns a non-2xx status", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response("quota exceeded", { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedText("anything")).rejects.toThrow(/Embedding failed: 429/);
  });

  it("rejects when the returned vector length does not match the configured dim", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ embedding: { values: [1, 2, 3] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedText("x")).rejects.toThrow(/expected 768 dims, got 3/);
  });
});
