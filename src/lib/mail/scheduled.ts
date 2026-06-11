import { supabaseAdmin } from "@/lib/supabase/server";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";

/**
 * Persistence + runner for scheduled emails. Rows live in
 * `public.scheduled_emails` (see 0007_scheduled_emails.sql). All access goes
 * through the service-role client — the table has RLS enabled with no public
 * policies.
 */

const TABLE = "scheduled_emails";

/** Public shape returned to the UI — no secrets, no body (can be large). */
export interface ScheduledEmail {
  id: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface ScheduledRow {
  id: string;
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
}

function toScheduledEmail(row: ScheduledRow): ScheduledEmail {
  return {
    id: row.id,
    fromEmail: row.from_email,
    toEmail: row.to_email,
    subject: row.subject,
    body: row.body,
    scheduledAt: row.scheduled_at,
    status: row.status as ScheduledEmail["status"],
    sentAt: row.sent_at,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ── Schedule ────────────────────────────────────────────────

interface ScheduleInput {
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
  scheduledAt: string; // ISO-8601 with tz
  createdBy?: string;
}

/**
 * Insert a pending scheduled email. Validates that `fromEmail` has a connected
 * mail account before inserting — rejects otherwise.
 */
export async function scheduleEmail(input: ScheduleInput): Promise<ScheduledEmail> {
  const account = await loadAccountWithSecretByEmail(input.fromEmail);
  if (!account) {
    throw new Error(
      `No connected mail account for "${input.fromEmail}". Connect it on the Emails page first.`,
    );
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      from_email: input.fromEmail.toLowerCase(),
      to_email: input.toEmail.toLowerCase(),
      subject: input.subject,
      body: input.body,
      scheduled_at: input.scheduledAt,
      status: "pending",
      created_by: input.createdBy ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to schedule email: ${error.message}`);
  return toScheduledEmail(data as ScheduledRow);
}

// ── List ────────────────────────────────────────────────────

/** Most recent 50 scheduled emails, all statuses. */
export async function listScheduled(): Promise<ScheduledEmail[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select("id, from_email, to_email, subject, body, scheduled_at, status, sent_at, error, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to list scheduled emails: ${error.message}`);
  return (data as ScheduledRow[]).map(toScheduledEmail);
}

// ── Cancel ──────────────────────────────────────────────────

/** Cancel a scheduled email — only if it's still pending. */
export async function cancelScheduled(id: string): Promise<ScheduledEmail> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();

  if (error) {
    throw new Error(
      `Cannot cancel email ${id}: it may not exist or is no longer pending.`,
    );
  }
  return toScheduledEmail(data as ScheduledRow);
}

// ── Runner ──────────────────────────────────────────────────

interface RunResult {
  sent: number;
  failed: number;
}

/**
 * Process due emails: select pending rows with `scheduled_at <= now()`, limit
 * 20, and send each via SMTP. Per-row error handling — one failure never aborts
 * the batch.
 */
export async function runDue(): Promise<RunResult> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error: selectError } = await db
    .from(TABLE)
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (selectError) throw new Error(`Failed to query due emails: ${selectError.message}`);
  if (!rows || rows.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const row of rows as ScheduledRow[]) {
    try {
      const account = await loadAccountWithSecretByEmail(row.from_email);
      if (!account) {
        throw new Error(`No connected mail account for "${row.from_email}"`);
      }

      await sendMail({
        account,
        to: row.to_email,
        subject: row.subject,
        body: row.body,
      });

      await db
        .from(TABLE)
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);

      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown send error";
      await db
        .from(TABLE)
        .update({ status: "failed", error: message })
        .eq("id", row.id);
      failed++;
    }
  }

  return { sent, failed };
}
