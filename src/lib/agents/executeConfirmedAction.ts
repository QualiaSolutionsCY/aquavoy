import {
  getItem,
  updateItem,
  deleteItem as deleteItemOnDrive,
} from "@/lib/microsoft/onedrive";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";
import { scheduleEmail } from "@/lib/mail/scheduled";
import { recordFinanceEntry, type FinanceDirection } from "@/lib/finance/ledger";
import { moveMessages } from "@/lib/mail/imap";
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

    case "record_finance_entry": {
      // Write one expense/income line to the finance ledger (ADR-005). This is
      // the real insert, reached only after the human confirmed the staged
      // action — a wrong invoice parse never books silently.
      const direction = str(args, "direction") as FinanceDirection;
      if (direction !== "expense" && direction !== "income")
        throw new Error('direction must be "expense" or "income"');

      const company = str(args, "company").trim();
      if (!company) throw new Error("company is required");

      const amount =
        typeof args.amount === "number" ? args.amount : Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("amount must be a finite number greater than 0");

      const currency = str(args, "currency").trim() || undefined;
      const docDate = str(args, "date").trim() || null;
      const description = str(args, "description").trim() || null;
      const sourceName = str(args, "sourceName").trim() || null;
      const sourceRef = str(args, "sourceRef").trim() || null;

      const { id } = await recordFinanceEntry({
        company,
        direction,
        amount,
        currency,
        docDate,
        description,
        sourceName,
        sourceRef,
        // Attribute the booking to the HMAC-verified principal, never a value
        // the model supplied.
        createdBy: principal,
      });
      return {
        result: { recorded: true, id, company, direction, amount },
        // undo = delete the booked entry. The reversal is dispatched by
        // pendingActions.undoAction (not in this builder's file set); that file
        // owns the tool→reversal switch and is wired in a follow-up to call
        // deleteFinanceEntry(financeEntryId). Until then record_finance_entry is
        // absent from REVERSIBLE_TOOLS, so the confirm card shows "cannot undo"
        // rather than offering a no-op Undo.
        undo_data: { financeEntryId: id },
      };
    }

    case "batch_move_to_trash":
    case "batch_move_to_folder": {
      // The matched UID set was captured at STAGE time (previewSenderMatches),
      // so this confirm step just performs the move the user approved. The move
      // is reversible — undo (pendingActions) moves the dest UIDs back to the
      // source folder using the uidMap captured here.
      const mailbox = str(args, "mailbox");
      const sourceFolderPath = str(args, "sourceFolderPath");
      const destFolderPath = str(args, "destFolderPath");
      if (!mailbox || !sourceFolderPath || !destFolderPath)
        throw new Error("mailbox, sourceFolderPath, and destFolderPath are required");

      const rawUids = Array.isArray(args.uids) ? args.uids : [];
      const uids = rawUids.filter(
        (u): u is number => typeof u === "number" && Number.isFinite(u),
      );
      if (uids.length === 0)
        throw new Error("no message UIDs staged to move");

      const res = await moveMessages(mailbox, sourceFolderPath, uids, destFolderPath);
      return {
        result: { moved: res.movedCount, destFolderPath },
        // undo = move the destination UIDs back to the source folder. The uidMap
        // (source UID → dest UID) lets undo target the messages at their new home.
        undo_data: {
          mailbox,
          sourceFolderPath,
          destFolderPath,
          uidMap: res.uidMap,
        },
      };
    }

    default:
      throw new Error(`Not a confirmable destructive action: ${tool}`);
  }
}
