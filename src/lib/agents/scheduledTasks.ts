import { supabaseAdmin } from "@/lib/supabase/server";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";
import { type Recurrence, isRecurring, nextOccurrence } from "@/lib/scheduleRecurrence";

/**
 * Persistence + runner for scheduled tasks / reminders. Rows live in
 * `public.scheduled_tasks` (see 0013_scheduled_tasks.sql). All access goes
 * through the service-role client — the table has RLS enabled with no public
 * policies.
 *
 * A reminder is a SELF-EMAIL: at the scheduled time the runner emails the
 * reminder TO the connected company `mailbox` so the team sees it in their
 * inbox. This mirrors the scheduled-email subsystem (src/lib/mail/scheduled.ts)
 * one-to-one — same structure, same conventions.
 */

const TABLE = "scheduled_tasks";

/** Public shape returned to the agent — camelCase, no row internals. */
export interface ScheduledTask {
  id: string;
  principal: string | null;
  mailbox: string;
  title: string;
  notes: string | null;
  scheduledAt: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  recurrence: Recurrence;
  recurrenceUntil: string | null;
}

interface ScheduledTaskRow {
  id: string;
  principal: string | null;
  mailbox: string;
  title: string;
  notes: string | null;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  recurrence: string;
  recurrence_until: string | null;
}

function toScheduledTask(row: ScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    principal: row.principal,
    mailbox: row.mailbox,
    title: row.title,
    notes: row.notes,
    scheduledAt: row.scheduled_at,
    status: row.status as ScheduledTask["status"],
    sentAt: row.sent_at,
    error: row.error,
    createdAt: row.created_at,
    recurrence: (row.recurrence ?? "none") as Recurrence,
    recurrenceUntil: row.recurrence_until,
  };
}

// ── Schedule ────────────────────────────────────────────────

interface ScheduleTaskInput {
  principal: string;
  mailbox: string;
  title: string;
  notes?: string;
  scheduledAt: string; // ISO-8601 with tz
  recurrence?: Recurrence; // default 'none' = fire once
  recurrenceUntil?: string; // ISO-8601 with tz; optional cap on recurrence
}

/**
 * Insert a pending reminder. Validates that `mailbox` has a connected mail
 * account before inserting — rejects otherwise — and rejects non-IMAP stacks
 * (ADR-004 / REQ-16: no silent cross-stack fallback).
 */
export async function scheduleTask(input: ScheduleTaskInput): Promise<ScheduledTask> {
  const account = await loadAccountWithSecretByEmail(input.mailbox);
  if (!account) {
    throw new Error(
      `No connected mail account for "${input.mailbox}". Connect it on the Emails page first.`,
    );
  }

  // ADR-004 / REQ-16: no silent cross-stack fallback
  if (account.mailStack !== "imap") {
    throw new Error(
      `Mailbox "${input.mailbox}" is owned by the ${account.mailStack} stack; scheduled company mail is sent only through IMAP/SMTP. No silent fallback (ADR-004 / REQ-16).`,
    );
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      principal: input.principal,
      mailbox: input.mailbox.toLowerCase(),
      title: input.title,
      notes: input.notes ?? null,
      scheduled_at: input.scheduledAt,
      status: "pending",
      recurrence: input.recurrence ?? "none",
      recurrence_until: input.recurrenceUntil ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to schedule task: ${error.message}`);
  return toScheduledTask(data as ScheduledTaskRow);
}

// ── List ────────────────────────────────────────────────────

/** Most recent 50 reminders for a principal, all statuses. */
export async function listTasks(principal: string): Promise<ScheduledTask[]> {
  const db = supabaseAdmin();
  // Principal isolation (REQ-3): scope to the principal's own reminders so one
  // operator never sees another's queue.
  const { data, error } = await db
    .from(TABLE)
    .select("id, principal, mailbox, title, notes, scheduled_at, status, sent_at, error, created_at, recurrence, recurrence_until")
    .eq("principal", principal)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`Failed to list scheduled tasks: ${error.message}`);
  return (data as ScheduledTaskRow[]).map(toScheduledTask);
}

// ── Cancel ──────────────────────────────────────────────────

/** Cancel a reminder — only if it's still pending and owned by the principal. */
export async function cancelTask(id: string, principal: string): Promise<ScheduledTask> {
  const db = supabaseAdmin();
  // Principal isolation (REQ-3): an operator can only cancel their own pending
  // reminders.
  const { data, error } = await db
    .from(TABLE)
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending")
    .eq("principal", principal)
    .select()
    .single();

  if (error) {
    throw new Error(
      `Cannot cancel task ${id}: it may not exist, is no longer pending, or is not yours.`,
    );
  }
  return toScheduledTask(data as ScheduledTaskRow);
}

// ── Runner ──────────────────────────────────────────────────

interface RunResult {
  sent: number;
  failed: number;
}

/**
 * Compute the DB patch to apply after a reminder is successfully delivered.
 * Non-recurring rows finalize as `sent` (unchanged behaviour). Recurring rows
 * advance to the next occurrence and re-queue as `pending` — unless that
 * occurrence falls past the `recurrence_until` cap, in which case they finalize
 * as `sent`. The next occurrence is always strictly in the future, so it cannot
 * double-fire within the same cron minute.
 */
function postSendPatch(
  recurrence: Recurrence,
  scheduledAt: string,
  recurrenceUntil: string | null,
  sentAt: string,
): Record<string, unknown> {
  if (!isRecurring(recurrence)) {
    return { status: "sent", sent_at: sentAt };
  }
  const next = nextOccurrence(new Date(scheduledAt), recurrence);
  if (recurrenceUntil && next.getTime() > new Date(recurrenceUntil).getTime()) {
    return { status: "sent", sent_at: sentAt };
  }
  return { status: "pending", sent_at: sentAt, scheduled_at: next.toISOString() };
}

/**
 * Process due reminders: select pending rows with `scheduled_at <= now()`, limit
 * 20, and email each TO its stored mailbox (a self-email). Per-row error
 * handling — one failure never aborts the batch.
 */
export async function runDueTasks(): Promise<RunResult> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: rows, error: selectError } = await db
    .from(TABLE)
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (selectError) throw new Error(`Failed to query due tasks: ${selectError.message}`);
  if (!rows || rows.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  for (const row of rows as ScheduledTaskRow[]) {
    try {
      const account = await loadAccountWithSecretByEmail(row.mailbox);
      if (!account) {
        throw new Error(`No connected mail account for "${row.mailbox}"`);
      }

      await sendMail({
        account,
        to: row.mailbox,
        subject: `Reminder: ${row.title}`,
        body: row.notes ? `${row.title}\n\n${row.notes}` : row.title,
      });

      const patch = postSendPatch(
        (row.recurrence ?? "none") as Recurrence,
        row.scheduled_at,
        row.recurrence_until,
        new Date().toISOString(),
      );
      await db.from(TABLE).update(patch).eq("id", row.id);

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
