import { getTavilyEnv } from "@/lib/env";

/**
 * Adapter over the Tavily Search API. The only file that knows Tavily's wire
 * format — the rest of the app calls `tavilySearch` and gets a structured result.
 */

const TAVILY_URL = "https://api.tavily.com/search";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySearchResponse {
  answer: string;
  results: TavilyResult[];
}

/**
 * Run a web search via Tavily. Returns an AI-generated answer plus the top
 * source results (title, URL, snippet). Never throws — errors are returned as
 * a structured response with the error in the answer field.
 */
export async function tavilySearch(query: string): Promise<TavilySearchResponse> {
  const env = getTavilyEnv();
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      max_results: 5,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return {
      answer: `Web search failed (${res.status}): ${detail.slice(0, 200)}`,
      results: [],
    };
  }

  const json = (await res.json()) as {
    answer?: string;
    results?: { title?: string; url?: string; content?: string }[];
  };

  return {
    answer: json.answer ?? "No answer generated.",
    results: (json.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: (r.content ?? "").slice(0, 500),
    })),
  };
}
