import { supabaseAdmin } from "@/lib/supabase/server";
import { embedText } from "@/lib/embeddings";
import { complete, type ChatMessage } from "@/lib/openrouter/client";

/**
 * Durable memory store (ADR-002, M2 Phase 1). Memory FORMATION: closed sessions
 * are reduced to discrete extracted facts/decisions, each embedded and stored in
 * public.memory_facts (0009_memory_facts.sql). Recall is a 3-signal HYBRID blend
 * — semantic cosine similarity ⊕ lexical hit ⊕ recency decay — plus an importance
 * weight, replacing the old chat_messages substring grep. Both recall paths
 * (autoRecall server-inject + the recall_memory tool) route through hybridRecall.
 *
 * Service-role only: every query is principal-scoped (REQ-3 / ADR-001) so recall
 * for one operator never surfaces another's facts.
 */

const TABLE = "memory_facts";

/** A row as fetched for ranking. `embedding` is parsed to number[]. */
export interface FactCandidate {
  id: string;
  fact: string;
  summary: string | null;
  importance: number;
  embedding: number[];
  created_at: string;
}

/** A ranked fact returned to a recall path. */
export interface RankedFact {
  id: string;
  fact: string;
  summary: string | null;
  importance: number;
  created_at: string;
  score: number;
}

/** Tunable ranker weights + recency half-life. Exposed for unit testing. */
export interface RankOptions {
  /** The query's embedding vector, for the cosine-similarity signal. */
  queryEmbedding: number[];
  weights?: { sim: number; lex: number; rec: number; imp: number };
  /** Recency half-life in hours (default 720h ≈ 30 days). */
  halfLifeHours?: number;
  /** Reference "now" in ms — injectable for deterministic tests. */
  nowMs?: number;
}

const DEFAULT_WEIGHTS = { sim: 0.5, lex: 0.2, rec: 0.2, imp: 0.1 };
const DEFAULT_HALF_LIFE_HOURS = 720;

/**
 * Salient query words: ≥5 chars, deduped — the same heuristic the old autoRecall
 * used (memoryTools.ts), reused so the lexical signal matches prior behavior.
 */
function salientWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 5),
    ),
  );
}

/** Cosine similarity of two equal-length vectors; 0 when either is degenerate. */
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Pure, deterministic ranker. For each candidate:
 *   score = w_sim·cosine + w_lex·lexicalHit + w_rec·recencyDecay + w_imp·importanceNorm
 * Returns candidates sorted by score descending; ties broken by created_at
 * descending (newest first). Same inputs → same order.
 */
export function rankFacts(
  query: string,
  candidates: FactCandidate[],
  opts: RankOptions,
): RankedFact[] {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const halfLife = opts.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const nowMs = opts.nowMs ?? Date.now();
  const words = salientWords(query);

  const scored = candidates.map((c) => {
    const sim = cosine(opts.queryEmbedding, c.embedding);
    const lexicalHit = words.some((w) => c.fact.toLowerCase().includes(w)) ? 1 : 0;
    const ageHours = Math.max(0, (nowMs - Date.parse(c.created_at)) / 3_600_000);
    const recencyDecay = Math.exp(-ageHours / halfLife);
    const importanceNorm = Math.min(1, Math.max(0, c.importance / 5));
    const score =
      weights.sim * sim +
      weights.lex * lexicalHit +
      weights.rec * recencyDecay +
      weights.imp * importanceNorm;
    return {
      id: c.id,
      fact: c.fact,
      summary: c.summary,
      importance: c.importance,
      created_at: c.created_at,
      score,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: newest first (deterministic).
    return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0;
  });
  return scored;
}

/** Parse a stored pgvector value (string "[..]" or array) to number[]. */
function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as number[];
    } catch {
      /* fall through */
    }
  }
  return [];
}

/**
 * Hybrid recall: embed the query, fetch principal-scoped candidate facts, rank
 * them, and return the top-K. Principal scoping enforces REQ-3 isolation — a
 * query for principal A never sees a principal-B row.
 */
export async function hybridRecall(
  query: string,
  principal: string,
  limit = 8,
): Promise<RankedFact[]> {
  const queryEmbedding = await embedText(query);

  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id, fact, summary, importance, embedding, created_at")
    .eq("principal", principal)
    .limit(200);

  if (error || !data || data.length === 0) return [];

  const candidates: FactCandidate[] = (data as Record<string, unknown>[]).map(
    (row) => ({
      id: String(row.id),
      fact: String(row.fact),
      summary: row.summary == null ? null : String(row.summary),
      importance: typeof row.importance === "number" ? row.importance : 1,
      embedding: parseEmbedding(row.embedding),
      created_at: String(row.created_at),
    }),
  );

  return rankFacts(query, candidates, { queryEmbedding }).slice(0, limit);
}

// ── Fact extraction (memory formation) ───────────────────────

/** A fact the LLM extracted from a session transcript. */
interface ExtractedFact {
  fact: string;
  importance: number;
}

const EXTRACTION_INSTRUCTIONS = [
  "You extract durable memory from a chat transcript between an operator and the",
  "Aquavoy assistant. Identify discrete, reusable FACTS and DECISIONS worth",
  "remembering long-term: preferences, agreed prices/terms, names, recurring",
  "tasks, commitments. Ignore small talk and one-off lookups.",
  "",
  "Return ONLY a JSON object of the shape:",
  '{ "summary": "<=1 sentence thread summary", "facts": [ { "fact": "self-contained statement", "importance": 1-5 } ] }',
  "importance: 5 = a firm decision/commitment; 1 = minor context. Return at most",
  "12 facts. If nothing is worth remembering, return an empty facts array.",
].join("\n");

interface ExtractionResult {
  summary?: string;
  facts?: ExtractedFact[];
}

/** Strip a ```json fenced block if the model wrapped its output. */
function stripFence(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : s).trim();
}

/**
 * Extract facts from a closed session's messages, embed each, and UPSERT into
 * memory_facts keyed on (session_id, fact). Idempotent: re-running over the same
 * session does not duplicate facts. Returns the number of facts written.
 */
export async function extractFacts(
  principal: string,
  sessionId: string,
  messages: { role: string; content: string }[],
): Promise<number> {
  if (messages.length === 0) return 0;

  const transcript = messages
    .map((m) => `${m.role === "user" ? principal : "Aquavoy"}: ${m.content}`)
    .join("\n");

  const promptMessages: ChatMessage[] = [
    { role: "system", content: EXTRACTION_INSTRUCTIONS },
    { role: "user", content: transcript },
  ];

  const raw = await complete(promptMessages);
  let parsed: ExtractionResult;
  try {
    parsed = JSON.parse(stripFence(raw)) as ExtractionResult;
  } catch {
    return 0;
  }

  const facts = (parsed.facts ?? []).filter(
    (f) => f && typeof f.fact === "string" && f.fact.trim().length > 0,
  );
  if (facts.length === 0) return 0;

  const summary = typeof parsed.summary === "string" ? parsed.summary : null;
  const db = supabaseAdmin();

  const rows = await Promise.all(
    facts.map(async (f) => {
      const fact = f.fact.trim();
      const importance =
        Number.isFinite(f.importance) && f.importance >= 1 && f.importance <= 5
          ? Math.round(f.importance)
          : 1;
      const embedding = await embedText(fact);
      return {
        principal,
        session_id: sessionId,
        fact,
        summary,
        embedding,
        importance,
      };
    }),
  );

  const { error } = await db
    .from(TABLE)
    .upsert(rows, { onConflict: "session_id,fact", ignoreDuplicates: false });

  if (error) throw new Error(`Fact extraction failed: ${error.message}`);
  return rows.length;
}
