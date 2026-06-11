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
