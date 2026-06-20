import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seam test for the inbox briefing generator. The IMAP read adapter and the
 * OpenRouter LLM client are both mocked — no socket, no upstream call. Asserts:
 * the structured briefing shape; identity/opts are threaded into the LLM call;
 * a malformed LLM reply degrades gracefully (no throw, safe empty structure);
 * and the empty-inbox short-circuit skips the LLM entirely.
 */

const { listEmailsMock, completeMock } = vi.hoisted(() => ({
  listEmailsMock: vi.fn(),
  completeMock: vi.fn(),
}));

vi.mock("./imap", () => ({ listEmails: listEmailsMock }));
vi.mock("@/lib/openrouter/client", () => ({ complete: completeMock }));

import { generateInboxBriefing } from "./briefing";

/** Two envelopes: one real client message, one obvious marketing blast. */
const emails = [
  {
    uid: 21,
    date: "2026-06-18T08:00:00.000Z",
    from: "Harbour Master <ops@port.example>",
    to: "info@aquavoy.com",
    subject: "Berth assignment for Tuesday",
    seen: false,
  },
  {
    uid: 22,
    date: "2026-06-18T07:30:00.000Z",
    from: "Mega Deals <noreply@deals.example>",
    to: "info@aquavoy.com",
    subject: "50% OFF everything — today only!!!",
    seen: false,
  },
];

const goodReply = JSON.stringify({
  summary: "One operational message about a berth assignment; the rest is promotional.",
  important: [
    {
      from: "Harbour Master <ops@port.example>",
      subject: "Berth assignment for Tuesday",
      reason: "Confirms a berth slot the crew must plan around.",
    },
  ],
  likelySpam: [
    { from: "Mega Deals <noreply@deals.example>", subject: "50% OFF everything — today only!!!" },
  ],
});

describe("mail/briefing generateInboxBriefing", () => {
  beforeEach(() => {
    listEmailsMock.mockReset();
    completeMock.mockReset();
  });

  it("returns the structured briefing shape from a well-formed LLM reply", async () => {
    listEmailsMock.mockResolvedValueOnce(emails);
    completeMock.mockResolvedValueOnce(goodReply);

    const briefing = await generateInboxBriefing("info@aquavoy.com");

    expect(briefing.mailbox).toBe("info@aquavoy.com");
    expect(briefing.total).toBe(2);
    expect(briefing.important).toEqual([
      {
        from: "Harbour Master <ops@port.example>",
        subject: "Berth assignment for Tuesday",
        reason: "Confirms a berth slot the crew must plan around.",
      },
    ]);
    expect(briefing.likelySpam).toEqual([
      { from: "Mega Deals <noreply@deals.example>", subject: "50% OFF everything — today only!!!" },
    ]);
    expect(briefing.summary).toMatch(/berth assignment/i);
  });

  it("fetches recent emails read-only and threads identity into the LLM opts", async () => {
    listEmailsMock.mockResolvedValueOnce(emails);
    completeMock.mockResolvedValueOnce(goodReply);

    await generateInboxBriefing("info@aquavoy.com", { identity: "Wency", limit: 20 });

    // listEmails is called with the mailbox, folder (undefined → inbox), and a count.
    expect(listEmailsMock).toHaveBeenCalledTimes(1);
    const [mailboxArg, folderArg, countArg] = listEmailsMock.mock.calls[0];
    expect(mailboxArg).toBe("info@aquavoy.com");
    expect(folderArg).toBeUndefined();
    expect(countArg).toBe(20);

    // identity is threaded through to complete(); folder/limit are NOT leaked as ChatOptions.
    expect(completeMock).toHaveBeenCalledTimes(1);
    const optsArg = completeMock.mock.calls[0][1];
    expect(optsArg).toMatchObject({ identity: "Wency" });
    expect(optsArg).not.toHaveProperty("folder");
    expect(optsArg).not.toHaveProperty("limit");
  });

  it("degrades gracefully when the LLM returns malformed JSON — no throw, safe structure", async () => {
    listEmailsMock.mockResolvedValueOnce(emails);
    completeMock.mockResolvedValueOnce("Sure! Here is your briefing: not actually JSON at all.");

    const briefing = await generateInboxBriefing("info@aquavoy.com");

    expect(briefing.total).toBe(2);
    expect(briefing.important).toEqual([]);
    expect(briefing.likelySpam).toEqual([]);
    expect(typeof briefing.summary).toBe("string");
    expect(briefing.summary.length).toBeGreaterThan(0);
  });

  it("parses JSON wrapped in a ```json fence", async () => {
    listEmailsMock.mockResolvedValueOnce(emails);
    completeMock.mockResolvedValueOnce("```json\n" + goodReply + "\n```");

    const briefing = await generateInboxBriefing("info@aquavoy.com");

    expect(briefing.important).toHaveLength(1);
    expect(briefing.likelySpam).toHaveLength(1);
  });

  it("drops malformed entries inside an otherwise-valid array without throwing", async () => {
    listEmailsMock.mockResolvedValueOnce(emails);
    completeMock.mockResolvedValueOnce(
      JSON.stringify({
        summary: "Mixed bag.",
        important: [
          { from: "Real <a@b.example>", subject: "Pay the invoice", reason: "Due today" },
          null,
          { nonsense: true },
        ],
        likelySpam: "not-an-array",
      }),
    );

    const briefing = await generateInboxBriefing("info@aquavoy.com");

    expect(briefing.important).toEqual([
      { from: "Real <a@b.example>", subject: "Pay the invoice", reason: "Due today" },
    ]);
    // A non-array likelySpam degrades to [] rather than throwing.
    expect(briefing.likelySpam).toEqual([]);
    expect(briefing.summary).toBe("Mixed bag.");
  });

  it("short-circuits on an empty mailbox and never calls the LLM", async () => {
    listEmailsMock.mockResolvedValueOnce([]);

    const briefing = await generateInboxBriefing("empty@aquavoy.com");

    expect(briefing.total).toBe(0);
    expect(briefing.important).toEqual([]);
    expect(briefing.likelySpam).toEqual([]);
    expect(briefing.summary).toMatch(/no recent messages/i);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
