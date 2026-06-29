import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the inbox classifier. The OpenRouter complete() adapter is
 * mocked — no upstream call. Asserts: correct category from a well-formed
 * response; JSON-fenced payloads parse correctly; malformed/unknown replies
 * degrade to "routine" without throwing.
 */

const { completeMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
}));

vi.mock("@/lib/openrouter/client", () => ({ complete: completeMock }));

import { classifyMessage } from "./inboxClassifier";

const sampleInput = {
  from: "billing@gefo.example",
  subject: "Credit Note CN-2026-047 — Voyage Aquavoy",
  body: "Please find attached the credit note for voyage AQ-2026-047.",
};

describe("mail/inboxClassifier classifyMessage", () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it("(a) returns the parsed category from a bare JSON response", async () => {
    completeMock.mockResolvedValueOnce('{"category":"creditNote"}');

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("creditNote");
  });

  it("(b) parses correctly when the response is wrapped in a ```json fence", async () => {
    completeMock.mockResolvedValueOnce(
      "```json\n" + '{"category":"voyageSummary"}' + "\n```",
    );

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("voyageSummary");
  });

  it("(c) returns 'routine' when the model returns non-JSON text", async () => {
    completeMock.mockResolvedValueOnce("not json");

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("routine");
  });

  it("(d) returns 'routine' when the category value is not one of the six literals", async () => {
    completeMock.mockResolvedValueOnce('{"category":"banana"}');

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("routine");
  });

  it("returns 'routine' when the model returns an empty string", async () => {
    completeMock.mockResolvedValueOnce("");

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("routine");
  });

  it("returns 'routine' when the model returns valid JSON but no category field", async () => {
    completeMock.mockResolvedValueOnce('{"label":"invoice"}');

    const result = await classifyMessage(sampleInput);

    expect(result).toBe("routine");
  });

  it("threads opts through to complete()", async () => {
    completeMock.mockResolvedValueOnce('{"category":"invoice"}');

    await classifyMessage(sampleInput, { identity: "Wency" });

    expect(completeMock).toHaveBeenCalledTimes(1);
    const optsArg = completeMock.mock.calls[0][1];
    expect(optsArg).toMatchObject({ identity: "Wency" });
  });

  it("passes all six valid category values through unchanged", async () => {
    const categories = [
      "invoice",
      "creditNote",
      "voyageSummary",
      "important",
      "routine",
      "spam",
    ] as const;

    for (const cat of categories) {
      completeMock.mockResolvedValueOnce(JSON.stringify({ category: cat }));
      const result = await classifyMessage(sampleInput);
      expect(result).toBe(cat);
    }
  });
});
