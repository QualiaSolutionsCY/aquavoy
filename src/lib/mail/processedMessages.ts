import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Idempotency store for inbox ingestion (REQ-29). Every message the cron
 * fetches is recorded here BEFORE it is staged as a pending_actions row.
 * On retry or overlap the cron checks isAlreadyProcessed() first and skips
 * any (mailbox, uid) pair that is already committed.
 *
 * Table: public.processed_messages (0018_processed_messages.sql)
 * Service-role only — RLS enabled, no policies.
 */

const TABLE = "processed_messages";

export interface MarkProcessedInput {
  mailbox: string;
  uid: number;
  messageId: string | null;
  category: string;
}

/**
 * Record that (mailbox, uid) has been processed. Uses upsert with
 * ignoreDuplicates so a racing duplicate is silently dropped — the first
 * writer wins and the constraint is never violated.
 *
 * Call this BEFORE inserting into pending_actions. A crash between the two
 * commits is safe: the next cron pass will see the processed record and skip
 * re-staging.
 */
export async function markProcessed(input: MarkProcessedInput): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from(TABLE).upsert(
    {
      mailbox: input.mailbox,
      uid: input.uid,
      message_id: input.messageId ?? null,
      category: input.category,
    },
    { onConflict: "mailbox,uid", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`processedMessages.markProcessed failed: ${error.message}`);
  }
}

/**
 * Check whether (mailbox, uid) has already been processed. Returns true if a
 * record exists (skip), false if it is safe to proceed.
 */
export async function isAlreadyProcessed(
  mailbox: string,
  uid: number,
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id")
    .eq("mailbox", mailbox)
    .eq("uid", uid)
    .maybeSingle();
  if (error) {
    throw new Error(`processedMessages.isAlreadyProcessed failed: ${error.message}`);
  }
  return data !== null;
}

/**
 * Delete processed_messages rows older than `olderThanDays` days (default 90).
 * Returns the number of rows deleted. Called by the memory sweep cron to keep
 * the table lean — messages from N days ago will never be re-delivered.
 */
export async function cleanupProcessed(olderThanDays = 90): Promise<number> {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .lt("processed_at", cutoff)
    .select("id");
  if (error) {
    throw new Error(`processedMessages.cleanupProcessed failed: ${error.message}`);
  }
  return (data ?? []).length;
}
