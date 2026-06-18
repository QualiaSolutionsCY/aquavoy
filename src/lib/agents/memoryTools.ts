import { hybridRecall, type RankedFact } from "@/lib/agents/memoryStore";

/**
 * Memory recall — the dual-path surface over the durable memory store. Both
 * paths route through the 3-signal hybrid ranker in memoryStore.ts (ADR-002):
 *   - recallMemory: the callable `recall_memory` tool (model-initiated). Its
 *     input/output JSON contract is unchanged from the old substring version.
 *   - autoRecall: server auto-inject on every chat request (model never has to
 *     "remember to remember"). Still returns string | null.
 *
 * Both are principal-scoped (REQ-3): recall for one operator never returns
 * another's facts. The old chat_messages substring grep is gone — recall now
 * blends semantic similarity, lexical hit, and recency over extracted facts.
 */

/** Format a fact's timestamp for display: "YYYY-MM-DD HH:MM". */
function whenOf(createdAt: string): string {
  return createdAt.slice(0, 16).replace("T", " ");
}

/**
 * Search durable memory for facts relevant to `query` for a given principal.
 * Returns up to 20 ranked hits as a JSON string. The output shape is unchanged
 * from the prior version — `{ hits: [{ role, content, created_at }] }` on a hit,
 * `{ message, hits: [] }` when empty, `{ error }` on failure — so the existing
 * recall_memory tool contract (and its test mock) hold.
 */
export async function recallMemory(
  query: string,
  principal: string,
): Promise<string> {
  let ranked: RankedFact[];
  try {
    ranked = await hybridRecall(query, principal, 20);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return JSON.stringify({ error: `Memory recall failed: ${message}` });
  }

  if (ranked.length === 0) {
    return JSON.stringify({
      message: `No past messages found matching "${query}" for ${principal}.`,
      hits: [],
    });
  }

  const hits = ranked.map((r) => ({
    role: "memory",
    content: r.fact.length > 500 ? r.fact.slice(0, 500) + "..." : r.fact,
    created_at: r.created_at,
  }));

  return JSON.stringify({ hits });
}

/**
 * Automatic recall — runs on EVERY chat request (server-side, before the model
 * sees the message). Routes through the same hybrid ranker as the tool, scoped to
 * the principal, and returns a context block to inject as a system note (or null
 * when nothing relevant is stored). This removes the "model forgot to check its
 * memory" failure mode: relevant history arrives whether or not the model thinks
 * to call recall_memory.
 */
export async function autoRecall(
  principal: string,
  userText: string,
): Promise<string | null> {
  if (!userText.trim()) return null;

  let ranked: RankedFact[];
  try {
    ranked = await hybridRecall(userText, principal, 6);
  } catch {
    return null;
  }

  if (ranked.length === 0) return null;

  const lines = ranked.map((r) => `- [${whenOf(r.created_at)}] ${r.fact}`);

  return [
    `Auto-recalled notes from ${principal}'s past conversations (may include the`,
    "current thread; use only what is relevant, ignore the rest):",
    ...lines,
  ].join("\n");
}
