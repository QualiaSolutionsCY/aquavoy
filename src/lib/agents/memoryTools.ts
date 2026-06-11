import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Memory recall — searches the chat_messages table for past conversation
 * content matching a query, filtered by principal. Used as a tool the model
 * can call to remember earlier conversations.
 */

interface MemoryHit {
  role: string;
  content: string;
  created_at: string;
}

/**
 * Search chat history for messages matching `query` (case-insensitive substring)
 * for a given principal. Returns up to 20 most recent matches, content trimmed
 * to 500 chars each.
 */
export async function recallMemory(
  query: string,
  principal: string,
): Promise<string> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("principal", principal)
    .ilike("content", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return JSON.stringify({ error: `Memory recall failed: ${error.message}` });
  }

  if (!data || data.length === 0) {
    return JSON.stringify({
      message: `No past messages found matching "${query}" for ${principal}.`,
      hits: [],
    });
  }

  const hits = (data as MemoryHit[]).map((row) => ({
    role: row.role,
    content: row.content.length > 500 ? row.content.slice(0, 500) + "..." : row.content,
    created_at: row.created_at,
  }));

  return JSON.stringify({ hits });
}

/**
 * Automatic recall — runs on EVERY chat request (server-side, before the model
 * sees the message). Extracts salient words from the user's message, searches
 * past conversations, and returns a context block to inject as a system note.
 * This removes the "model forgot to check its memory" failure mode: relevant
 * history arrives whether or not the model thinks to call recall_memory.
 */
export async function autoRecall(
  principal: string,
  userText: string,
): Promise<string | null> {
  // Salient words: ≥5 chars, deduped, max 4 — short Dutch/English function
  // words (wat/moet/doen/voor/…) stay out by length alone.
  const words = Array.from(
    new Set(
      userText
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 5),
    ),
  ).slice(0, 4);
  if (words.length === 0) return null;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("principal", principal)
    .or(words.map((w) => `content.ilike.%${w}%`).join(","))
    .order("created_at", { ascending: false })
    .limit(6);

  if (error || !data || data.length === 0) return null;

  const lines = (data as MemoryHit[]).map((row) => {
    const when = row.created_at.slice(0, 16).replace("T", " ");
    const text = row.content.length > 300 ? row.content.slice(0, 300) + "…" : row.content;
    return `- [${when}] ${row.role === "user" ? principal : "Aquavoy"}: ${text}`;
  });

  return [
    `Auto-recalled notes from ${principal}'s past conversations (may include the`,
    "current thread; use only what is relevant, ignore the rest):",
    ...lines,
  ].join("\n");
}
