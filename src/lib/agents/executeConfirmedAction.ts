import {
  getItem,
  updateItem,
  deleteItem as deleteItemOnDrive,
  uploadFile,
  downloadContent,
} from "@/lib/microsoft/onedrive";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { loadAccountWithSecretByEmail } from "@/lib/mail/accounts";
import { sendMail } from "@/lib/mail/smtp";
import { scheduleEmail } from "@/lib/mail/scheduled";
import { recordFinanceEntry, type FinanceDirection } from "@/lib/finance/ledger";
import { recordVoyageEntry } from "@/lib/finance/voyageLedger";
import { appendVoyageRow } from "@/lib/finance/excelRegister";
import { moveMessages, downloadAttachment } from "@/lib/mail/imap";
import type { Recurrence } from "@/lib/scheduleRecurrence";
import { readFileSync } from "fs";
import { join } from "path";
import { getInvoiceTemplate } from "@/lib/agents/invoiceTemplates";
import { fillInvoiceTemplate, type InvoiceFields } from "@/lib/agents/invoiceTemplate";

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

      // Message-IDs captured at stage time (source UID → Message-ID). They give
      // undo a capability-independent way to re-locate the moved messages when
      // the server lacks UIDPLUS and the uidMap comes back empty (§A1).
      const messageIds =
        args.messageIds && typeof args.messageIds === "object"
          ? (args.messageIds as Record<string, string>)
          : {};

      const res = await moveMessages(mailbox, sourceFolderPath, uids, destFolderPath);
      return {
        result: { moved: res.movedCount, destFolderPath },
        // undo = move the destination UIDs back to the source folder. The uidMap
        // (source UID → dest UID) lets undo target the messages at their new home;
        // messageIds is the fallback when the server lacks UIDPLUS.
        undo_data: {
          mailbox,
          sourceFolderPath,
          destFolderPath,
          uidMap: res.uidMap,
          messageIds,
        },
      };
    }

    case "save_email_attachment": {
      const mailbox = str(args, "mailbox");
      const uid = Number(args.uid);
      const attachmentFilename = str(args, "attachmentFilename");
      const folder = str(args, "folder") || undefined;
      const targetFolderId = str(args, "targetFolderId") || undefined;
      const targetFolderPath = str(args, "targetFolderPath") || undefined;
      if (!mailbox || !uid || isNaN(uid) || !attachmentFilename)
        throw new Error("mailbox, uid, and attachmentFilename are required");
      const att = await downloadAttachment(mailbox, folder, uid, attachmentFilename);
      const connId = await resolveConnectionId();
      const parent = targetFolderId
        ? { itemId: targetFolderId }
        : targetFolderPath
          ? { path: targetFolderPath }
          : {};
      const item = await uploadFile(connId, parent, att.filename, att.bytes, att.contentType);
      return {
        result: { saved: true, itemId: item.id, name: item.name, webUrl: item.webUrl ?? null },
        undo_data: { uploadedItemId: item.id },
      };
    }

    case "record_voyage_entry": {
      // Two writes happen here, both are side-effects of the same confirmed action
      // (ADR-003 / REQ-28): (1) insert into voyage_entries, (2) append the row to
      // the current-year sheet of Reis registratie.xlsx and re-upload in place.
      const company = str(args, "company").trim();
      if (!company) throw new Error("company is required");

      const year = str(args, "year").trim();
      if (!year) throw new Error("year is required");

      const registerItemId = str(args, "registerItemId").trim();
      if (!registerItemId) throw new Error("registerItemId is required");

      // Helper: coerce a possibly-absent numeric arg to number | null.
      const num = (k: string): number | null => {
        const v = args[k];
        if (v == null) return null;
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };

      // (1) Insert the voyage index row.
      const { id } = await recordVoyageEntry({
        company,
        voyage_no: str(args, "voyage_no") || null,
        charterer: str(args, "charterer") || null,
        port_from: str(args, "port_from") || null,
        port_to: str(args, "port_to") || null,
        load_date: str(args, "load_date") || null,
        discharge_date: str(args, "discharge_date") || null,
        cargo_type: str(args, "cargo_type") || null,
        tonnage: num("tonnage"),
        price_per_ton: num("price_per_ton"),
        kwz: str(args, "kwz") || null,
        total: num("total"),
        revenue: num("revenue"),
        handler_provision: num("handler_provision"),
        demurrage: num("demurrage"),
        fuel: num("fuel"),
        fuel_price: num("fuel_price"),
        oil_cost: num("oil_cost"),
        port_dues_load: num("port_dues_load"),
        port_dues_discharge: num("port_dues_discharge"),
        net: num("net"),
        waiting_days: num("waiting_days"),
        net_per_day: num("net_per_day"),
        gmp: str(args, "gmp") || null,
        material_cleaned: str(args, "material_cleaned") || null,
        zhc: str(args, "zhc") || null,
        note: str(args, "note") || null,
        createdBy: principal,
        sourceRef: registerItemId,
      });

      // (2) Download the register, append the row, re-upload in place.
      const connId = await resolveConnectionId();
      const res = await downloadContent(connId, registerItemId);
      const buf = new Uint8Array(await res.arrayBuffer());
      const newBuf = await appendVoyageRow(buf, year, {
        voyage_no: str(args, "voyage_no") || null,
        charterer: str(args, "charterer") || null,
        port_from: str(args, "port_from") || null,
        port_to: str(args, "port_to") || null,
        load_date: str(args, "load_date") || null,
        discharge_date: str(args, "discharge_date") || null,
        cargo_type: str(args, "cargo_type") || null,
        tonnage: num("tonnage"),
        price_per_ton: num("price_per_ton"),
        kwz: str(args, "kwz") || null,
        total: num("total"),
        revenue: num("revenue"),
        handler_provision: num("handler_provision"),
        demurrage: num("demurrage"),
        fuel: num("fuel"),
        fuel_price: num("fuel_price"),
        oil_cost: num("oil_cost"),
        port_dues_load: num("port_dues_load"),
        port_dues_discharge: num("port_dues_discharge"),
        net: num("net"),
        waiting_days: num("waiting_days"),
        net_per_day: num("net_per_day"),
        gmp: str(args, "gmp") || null,
        material_cleaned: str(args, "material_cleaned") || null,
        zhc: str(args, "zhc") || null,
        note: str(args, "note") || null,
      });
      // Re-upload to the same folder (by parentId) with the same filename,
      // overwriting the original in place. Using itemId for the parent avoids
      // path-traversal concerns and correctly targets the containing folder.
      const item = await getItem(connId, { itemId: registerItemId });
      const parentRef = item.parentId ? { itemId: item.parentId } : {};
      await uploadFile(
        connId,
        parentRef,
        item.name,
        newBuf,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      return {
        result: { recorded: true, voyageEntryId: id, registerItemId, year },
        undo_data: { voyageEntryId: id, registerItemId, year, appendedRow: true },
      };
    }

    case "import_voyage_register": {
      // Insert every staged parsed row into voyage_entries (ADR-006 confirm-before-write).
      // The parsed rows were captured at stage time (readRegister); the Excel file
      // is never modified here — this is a read-only import into the DB index.
      const company = str(args, "company").trim();
      if (!company) throw new Error("company is required");

      const registerItemId = str(args, "registerItemId").trim();
      if (!registerItemId) throw new Error("registerItemId is required");

      const rows = Array.isArray(args.rows) ? args.rows : [];
      const ids: string[] = [];

      for (const r of rows) {
        const rowArgs = (r ?? {}) as Record<string, unknown>;
        const { id } = await recordVoyageEntry({
          company,
          voyage_no: typeof rowArgs.voyage_no === "string" ? rowArgs.voyage_no || null : null,
          charterer: typeof rowArgs.charterer === "string" ? rowArgs.charterer || null : null,
          port_from: typeof rowArgs.port_from === "string" ? rowArgs.port_from || null : null,
          port_to: typeof rowArgs.port_to === "string" ? rowArgs.port_to || null : null,
          load_date: typeof rowArgs.load_date === "string" ? rowArgs.load_date || null : null,
          discharge_date: typeof rowArgs.discharge_date === "string" ? rowArgs.discharge_date || null : null,
          cargo_type: typeof rowArgs.cargo_type === "string" ? rowArgs.cargo_type || null : null,
          tonnage: rowArgs.tonnage != null ? (Number.isFinite(Number(rowArgs.tonnage)) ? Number(rowArgs.tonnage) : null) : null,
          price_per_ton: rowArgs.price_per_ton != null ? (Number.isFinite(Number(rowArgs.price_per_ton)) ? Number(rowArgs.price_per_ton) : null) : null,
          kwz: typeof rowArgs.kwz === "string" ? rowArgs.kwz || null : null,
          total: rowArgs.total != null ? (Number.isFinite(Number(rowArgs.total)) ? Number(rowArgs.total) : null) : null,
          revenue: rowArgs.revenue != null ? (Number.isFinite(Number(rowArgs.revenue)) ? Number(rowArgs.revenue) : null) : null,
          handler_provision: rowArgs.handler_provision != null ? (Number.isFinite(Number(rowArgs.handler_provision)) ? Number(rowArgs.handler_provision) : null) : null,
          demurrage: rowArgs.demurrage != null ? (Number.isFinite(Number(rowArgs.demurrage)) ? Number(rowArgs.demurrage) : null) : null,
          fuel: rowArgs.fuel != null ? (Number.isFinite(Number(rowArgs.fuel)) ? Number(rowArgs.fuel) : null) : null,
          fuel_price: rowArgs.fuel_price != null ? (Number.isFinite(Number(rowArgs.fuel_price)) ? Number(rowArgs.fuel_price) : null) : null,
          oil_cost: rowArgs.oil_cost != null ? (Number.isFinite(Number(rowArgs.oil_cost)) ? Number(rowArgs.oil_cost) : null) : null,
          port_dues_load: rowArgs.port_dues_load != null ? (Number.isFinite(Number(rowArgs.port_dues_load)) ? Number(rowArgs.port_dues_load) : null) : null,
          port_dues_discharge: rowArgs.port_dues_discharge != null ? (Number.isFinite(Number(rowArgs.port_dues_discharge)) ? Number(rowArgs.port_dues_discharge) : null) : null,
          net: rowArgs.net != null ? (Number.isFinite(Number(rowArgs.net)) ? Number(rowArgs.net) : null) : null,
          waiting_days: rowArgs.waiting_days != null ? (Number.isFinite(Number(rowArgs.waiting_days)) ? Number(rowArgs.waiting_days) : null) : null,
          net_per_day: rowArgs.net_per_day != null ? (Number.isFinite(Number(rowArgs.net_per_day)) ? Number(rowArgs.net_per_day) : null) : null,
          gmp: typeof rowArgs.gmp === "string" ? rowArgs.gmp || null : null,
          material_cleaned: typeof rowArgs.material_cleaned === "string" ? rowArgs.material_cleaned || null : null,
          zhc: typeof rowArgs.zhc === "string" ? rowArgs.zhc || null : null,
          note: typeof rowArgs.note === "string" ? rowArgs.note || null : null,
          createdBy: principal,
          sourceRef: registerItemId,
        });
        ids.push(id);
      }

      return {
        result: { imported: ids.length, voyageEntryIds: ids },
        undo_data: { voyageEntryIds: ids },
      };
    }

    case "generate_invoice_from_template": {
      const company = str(args, "company") as "Gefo" | "Novo Porto";
      if (company !== "Gefo" && company !== "Novo Porto")
        throw new Error('company must be "Gefo" or "Novo Porto"');

      const invoiceNumber = str(args, "invoice_number");
      if (!invoiceNumber) throw new Error("invoice_number is required");

      // targetYear is LLM-supplied; only accept a 4-digit year, else fall back to
      // the current year — it is spliced into the OneDrive upload path (SEC-01).
      const rawYear = str(args, "targetYear");
      const year = /^\d{4}$/.test(rawYear) ? rawYear : String(new Date().getFullYear());

      // Per-company template row from Supabase (ADR-007 §4).
      const row = await getInvoiceTemplate(company);

      // Load the committed .docx template. `template_ref` is a repo-relative
      // path (e.g. "assets/invoice-templates/gefo.docx"); resolve from the
      // project root (process.cwd() in Next.js / the Railway/Vercel build root).
      const templatePath = join(process.cwd(), row.template_ref);
      const templateBuffer = readFileSync(templatePath);

      const fields: InvoiceFields = {
        recipient_name: str(args, "recipient_name"),
        recipient_address: str(args, "recipient_address"),
        recipient_vat: str(args, "recipient_vat"),
        vessel: str(args, "vessel"),
        invoice_date: str(args, "invoice_date"),
        invoice_number: invoiceNumber,
        crewing: str(args, "crewing") || "0.00",
        travel: str(args, "travel") || "0.00",
        service_fee: str(args, "service_fee") || "0.00",
        cash_advance: str(args, "cash_advance") || "0.00",
        total: str(args, "total"),
        currency: str(args, "currency") || "EUR",
      };

      const filledBuffer = fillInvoiceTemplate(templateBuffer, fields);

      // Build the filename per company convention.
      // Gefo:       "{number} Invoice Aquavoy - Gefo {date} voyage NN.docx"
      // Novo Porto: "{number} Aquavoy Ltd - Novo Porto Scheepvaart BV {date}.docx"
      const filename =
        company === "Gefo"
          ? `${invoiceNumber} Invoice Aquavoy - Gefo ${fields.invoice_date} voyage.docx`
          : `${invoiceNumber} Aquavoy Ltd - Novo Porto Scheepvaart BV ${fields.invoice_date}.docx`;

      const connId = await resolveConnectionId();
      const destPath = `${row.output_folder_path}/${year}`;
      const DOCX_MIME =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const item = await uploadFile(
        connId,
        { path: destPath },
        filename,
        filledBuffer,
        DOCX_MIME,
      );

      return {
        result: {
          generated: true,
          itemId: item.id,
          name: item.name,
          webUrl: item.webUrl ?? null,
        },
        undo_data: { uploadedItemId: item.id },
      };
    }

    default:
      throw new Error(`Not a confirmable destructive action: ${tool}`);
  }
}
