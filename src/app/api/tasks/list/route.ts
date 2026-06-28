import { NextRequest, NextResponse } from "next/server";
import { handle, ok, fail } from "@/lib/http";
import { getPrincipal } from "@/lib/auth/session";
import { listTasks } from "@/lib/agents/scheduledTasks";
import { listScheduled } from "@/lib/mail/scheduled";
import type { ScheduledTask } from "@/lib/agents/scheduledTasks";
import type { ScheduledEmail } from "@/lib/mail/scheduled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unified task item shape for the /tasks oversight page. */
export type TaskItem =
  | {
      kind: "reminder";
      id: string;
      status: ScheduledTask["status"];
      scheduledAt: string;
      recurrence: ScheduledTask["recurrence"];
      mailbox: string;
      title: string;
      error: string | null;
    }
  | {
      kind: "email";
      id: string;
      status: ScheduledEmail["status"];
      scheduledAt: string;
      recurrence: ScheduledEmail["recurrence"];
      fromEmail: string;
      toEmail: string;
      subject: string;
      error: string | null;
    };

/**
 * GET /api/tasks/list
 * Returns a merged, scheduledAt-descending list of the principal's reminders
 * and scheduled emails. Principal isolation (REQ-3): scoped to the calling
 * operator — one operator never sees another's queue.
 */
export function GET(req: NextRequest): Promise<NextResponse> {
  return handle(async () => {
    const principal = getPrincipal(req);
    if (!principal) return fail("Unauthorized", 401);

    const [reminders, emails] = await Promise.all([
      listTasks(principal),
      listScheduled(principal),
    ]);

    const reminderItems: TaskItem[] = reminders.map((r) => ({
      kind: "reminder",
      id: r.id,
      status: r.status,
      scheduledAt: r.scheduledAt,
      recurrence: r.recurrence,
      mailbox: r.mailbox,
      title: r.title,
      error: r.error,
    }));

    const emailItems: TaskItem[] = emails.map((e) => ({
      kind: "email",
      id: e.id,
      status: e.status,
      scheduledAt: e.scheduledAt,
      recurrence: e.recurrence,
      fromEmail: e.fromEmail,
      toEmail: e.toEmail,
      subject: e.subject,
      error: e.error,
    }));

    const merged = [...reminderItems, ...emailItems].sort(
      (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
    );

    return ok(merged);
  });
}
