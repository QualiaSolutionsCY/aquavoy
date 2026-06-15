import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the Graph transport. We mock the token resolver (./connections)
 * and stub global fetch — no network. Asserts the Bearer header is attached and
 * that non-2xx responses surface as a typed GraphError.
 */
vi.mock("./connections", () => ({
  getValidAccessToken: vi.fn(async () => "test-access-token"),
}));

import { graphJson, graphRaw, GraphError } from "./graph";
import { getValidAccessToken } from "./connections";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("microsoft/graph transport", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getValidAccessToken).mockClear();
  });

  it("attaches a Bearer header and returns parsed JSON on 2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ value: "ok" }));

    const result = await graphJson<{ value: string }>("conn-1", { path: "/me" });

    expect(result).toEqual({ value: "ok" });
    expect(getValidAccessToken).toHaveBeenCalledWith("conn-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-access-token",
    );
  });

  it("returns undefined for a 204 No Content response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await graphJson<undefined>("conn-1", {
      method: "DELETE",
      path: "/me/drive/items/x",
    });
    expect(result).toBeUndefined();
  });

  it("throws a GraphError carrying status + code on a non-2xx JSON error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "itemNotFound", message: "The resource was not found." } },
        404,
      ),
    );

    await expect(graphJson("conn-1", { path: "/me/drive/items/missing" })).rejects
      .toMatchObject({ status: 404, code: "itemNotFound" });

    const caught = await graphJson("conn-1", { path: "/x" }).catch((e) => e);
    expect(caught).toBeInstanceOf(GraphError);
  });

  it("graphRaw returns the raw Response without parsing", async () => {
    const raw = jsonResponse({ streamed: true });
    fetchMock.mockResolvedValueOnce(raw);
    const res = await graphRaw("conn-2", { path: "/me/drive/items/x/content" });
    expect(res).toBe(raw);
  });
});
