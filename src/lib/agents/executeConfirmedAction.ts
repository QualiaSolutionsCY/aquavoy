import {
  getItem,
  updateItem,
  deleteItem as deleteItemOnDrive,
} from "@/lib/microsoft/onedrive";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";
import { scheduleEmail } from "@/lib/mail/scheduled";
import type { Recurrence } from "@/lib/scheduleRecurrence";

/**
 * The real side-effects for destructive tools. This is the ONLY place the
 * actual mutation happens — `executeTool` never calls these. The confirm
 * endpoint (Wave 2) is the sole caller, after a human has confirmed the staged
 * `pending_actions` row (ADR-003 §3). Keeping the side-effect out of the model
 * tool loop is the enforcement: the model has no code path to it.
 *
 * Returns `{ result, undo_data }`. `undo_data` captures whatever the undo path
 * needs to reverse the action (prior parent/name for move/rename, the scheduled
 * row id for schedule_email). Throws on failure — the caller records the
 * failure on the pending row.
 */

interface ConfirmedOutcome {
  result: unknown;
  undo_data: Record<string, unknown> | null;
}

function str(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string) : "";
}

export async function executeConfirmedAction(
  tool: string,
  args: Record<string, unknown>,
  principal: string,
): Promise<ConfirmedOutcome> {
  switch (tool) {
    case "move_item": {
      const itemId = str(args, "itemId");
      const newParentId = str(args, "newParentId");
      if (!itemId || !newParentId)
        throw new Error("itemId and newParentId are required");
      const connId = await resolveConnectionId();
      // Capture prior location FIRST so undo can reverse the move.
      const before = await getItem(connId, { itemId });
      const moved = await updateItem(connId, itemId, { newParentId });
      return {
        result: {
          name: moved.name,
          id: moved.id,
          isFolder: moved.isFolder,
          parentId: moved.parentId,
        },
        undo_data: {
          priorParentId: before.parentId ?? null,
          priorName: before.name,
        },
      };
    }

    case "rename_item": {
      const itemId = str(args, "itemId");
      const newName = str(args, "newName");
      if (!itemId || !newName)
        throw new Error("itemId and newName are required");
      const connId = await resolveConnectionId();
      const before = await getItem(connId, { itemId });
      const renamed = await updateItem(connId, itemId, { newName });
      return {
        result: { name: renamed.name, id: renamed.id, isFolder: renamed.isFolder },
        undo_data: {
          priorParentId: before.parentId ?? null,
          priorName: before.name,
        },
      };
    }

    case "delete_item": {
      const itemId = str(args, "itemId");
      if (!itemId) throw new Error("itemId is required");
      const connId = await resolveConnectionId();
      // Capture name before deleting for the audit/undo record. Graph delete
      // moves the item to the recycle bin; undo is best-effort (see undoAction).
      const before = await getItem(connId, { itemId }).catch(() => null);
      await deleteItemOnDrive(connId, itemId);
      return {
        result: { deleted: true, itemId },
        undo_data: {
          priorParentId: before?.parentId ?? null,
          priorName: before?.name ?? null,
        },
      };
    }

    case "send_email": {
      const from = str(args, "from");
      const to = str(args, "to");
      const subject = str(args, "subject");
      const body = str(args, "body");
      if (!from || !to || !subject || !body)
        throw new Error("from, to, subject, and body are all required");

      const account = await loadAccountWithSecretByEmail(from);
      if (!account) {
        throw new Error(`No connected mail account for "${from}".`);
      }

      // ADR-004 / REQ-16: no silent cross-stack fallback
      if (account.mailStack !== "imap") {
        throw new Error(
          `Mailbox "${from}" is owned by the ${account.mailStack} stack; the agent only sends company mail through IMAP/SMTP. No silent fallback (ADR-004 / REQ-16).`,
        );
      }

      await sendMail({ account, to, subject, body });
      return {
        result: { sent: true, from: account.email, to, subject },
        // send is irreversible — no undo_data.
        undo_data: null,
      };
    }

    case "schedule_email": {
      const from = str(args, "from");
      const to = str(args, "to");
      const subject = str(args, "subject");
      const body = str(args, "body");
      const sendAt = str(args, "sendAt");
      if (!from || !to || !subject || !body || !sendAt)
        throw new Error("from, to, subject, body, and sendAt are all required");

      const sendDate = new Date(sendAt);
      if (isNaN(sendDate.getTime()))
        throw new Error("sendAt must be a valid ISO-8601 datetime");
      if (sendDate.getTime() <= Date.now())
        throw new Error("sendAt must be in the future");

      // Optional recurrence — repeats the send (e.g. the monthly invoices to
      // the accountant). Unknown/absent values fall back to a one-shot send.
      const rawRecurrence = str(args, "recurrence");
      const recurrence: Recurrence = (
        ["none", "daily", "weekly", "monthly"] as const
      ).includes(rawRecurrence as Recurrence)
        ? (rawRecurrence as Recurrence)
        : "none";
      const rawUntil = str(args, "recurrenceUntil");
      const recurrenceUntil =
        rawUntil && !isNaN(new Date(rawUntil).getTime()) ? rawUntil : undefined;

      const row = await scheduleEmail({
        fromEmail: from,
        toEmail: to,
        subject,
        body,
        scheduledAt: sendAt,
        recurrence,
        recurrenceUntil,
        // Own the scheduled email by the verified principal so REQ-3-scoped
        // list/cancel can find it (and only its owner can cancel it).
        createdBy: principal,
      });
      return {
        result: {
          scheduled: true,
          id: row.id,
          from: row.fromEmail,
          to: row.toEmail,
          subject: row.subject,
          scheduledAt: row.scheduledAt,
          recurrence: row.recurrence,
        },
        // undo = cancel the queued row if still pending.
        undo_data: { scheduledId: row.id },
      };
    }

    default:
      throw new Error(`Not a confirmable destructive action: ${tool}`);
  }
}
