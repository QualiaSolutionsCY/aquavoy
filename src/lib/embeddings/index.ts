import { getEmbeddingsEnv } from "@/lib/env";

/**
 * Embedding adapter (ADR-002 §3 — adapters-at-seams). This is the ONLY file that
 * knows the embedding provider's wire format. The durable-memory ranker and the
 * fact-writer call `embedText` without any knowledge of the provider, so swapping
 * providers is a one-file change. Default provider: Gemini via the existing
 * GOOGLE_API_KEY path (mirrors the chat provider resolution in
 * src/lib/openrouter/client.ts:209-226); model + dimension are config.
 *
 * Server-only — reads GOOGLE_API_KEY, which must never reach the browser bundle.
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiEmbedResponse {
  embedding?: { values?: number[] };
}

/**
 * Embed a single string into a fixed-dimension vector. Throws on a non-2xx
 * response or when the returned vector length does not match the configured
 * dimension (which must equal the vector(N) column in 0009_memory_facts.sql).
 */
export async function embedText(text: string): Promise<number[]> {
  const env = getEmbeddingsEnv();
  const url = `${GEMINI_BASE}/${env.EMBEDDING_MODEL}:embedContent`;

  // 30s timeout: a hung embedding upstream must not pin the serverless function.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GOOGLE_API_KEY,
      },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        output_dimensionality: env.EMBEDDING_DIM,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Embedding failed: request timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as GeminiEmbedResponse;
  const values = json.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error("Embedding failed: response missing embedding.values");
  }
  if (values.length !== env.EMBEDDING_DIM) {
    throw new Error(
      `Embedding failed: expected ${env.EMBEDDING_DIM} dims, got ${values.length}`,
    );
  }
  return values;
}
