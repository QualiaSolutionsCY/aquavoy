import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { updateItem, deleteItem as deleteItemOnDrive } from "@/lib/microsoft/onedrive";
import { cancelScheduled } from "@/lib/mail/scheduled";
import { deleteFinanceEntry } from "@/lib/finance/ledger";
import { deleteVoyageEntry } from "@/lib/finance/voyageLedger";
import { moveMessages, moveMessagesByMessageId } from "@/lib/mail/imap";
import { executeConfirmedAction } from "@/lib/agents/executeConfirmedAction";

/**
 * Persistence + lifecycle for staged destructive actions (ADR-003). Rows live
 * in `public.pending_actions` (see 0010_pending_actions.sql). All access goes
 * through the service-role client — the table has RLS enabled with no public
 * policies, and every query is scoped to the session `principal` (ADR-001 /
 * REQ-3), never to a value the model supplied.
 *
 * Lifecycle: `pending` → (`confirmed` | `cancelled` | `failed`); a `confirmed`
 * reversible action can then move to `undone`. The status guards on UPDATE make
 * each transition idempotent (a re-confirm hits 0 rows).
 */

const TABLE = "pending_actions";

export type PendingStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "undone"
  | "failed";

export interface PendingAction {
  id: string;
  principal: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  status: PendingStatus;
  undoData: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface PendingRow {
  id: string;
  principal: string;
  tool: string;
  args: Record<string, unknown> | null;
  summary: string;
  status: string;
  undo_data: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
}

function toPendingAction(row: PendingRow): PendingAction {
  return {
    id: row.id,
    principal: row.principal,
    tool: row.tool,
    args: row.args ?? {},
    summary: row.summary,
    status: row.status as PendingStatus,
    undoData: row.undo_data,
    result: row.result,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

const COLUMNS =
  "id, principal, tool, args, summary, status, undo_data, result, created_at, resolved_at";

// ── Stage ────────────────────────────────────────────────────

interface StageInput {
  principal: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

/** Insert a `pending` action for the principal. Returns the staged row. */
export async function stagePendingAction(input: StageInput): Promise<PendingAction> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      principal: input.principal,
      tool: input.tool,
      args: input.args,
      summary: input.summary,
      status: "pending",
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to stage pending action: ${error.message}`);
  return toPendingAction(data as PendingRow);
}

// ── List ─────────────────────────────────────────────────────

/** The principal's still-pending actions, newest first. */
export async function listPendingActions(principal: string): Promise<PendingAction[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("principal", principal)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list pending actions: ${error.message}`);
  return (data as PendingRow[]).map(toPendingAction);
}

// ── Get ──────────────────────────────────────────────────────

/**
 * Fetch a single action by id, scoped to the principal (REQ-3). Returns null
 * when it does not exist OR belongs to a different principal — the caller
 * cannot distinguish the two, which is the point.
 */
export async function getPendingAction(
  id: string,
  principal: string,
): Promise<PendingAction | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("id", id)
    .eq("principal", principal)
    .maybeSingle();

  if (error) throw new Error(`Failed to load pending action: ${error.message}`);
  if (!data) return null;
  return toPendingAction(data as PendingRow);
}

// ── Confirm ──────────────────────────────────────────────────

/**
 * Run the side-effect for a pending action and record the outcome. The UPDATE
 * is status-guarded on `pending`, so a re-confirm hits 0 rows and is a no-op
 * (idempotent). On a side-effect throw the row is marked `failed` with the
 * error and the throw is re-raised to the caller.
 */
export async function confirmAction(
  id: string,
  principal: string,
): Promise<PendingAction | null> {
  const db = supabaseAdmin();

  // Atomic claim FIRST (adversarial MEDIUM-2): flip pending→confirmed in one
  // guarded UPDATE. Postgres serializes concurrent UPDATEs on the same row, so
  // only ONE confirm wins the `status='pending'` predicate — the loser updates
  // 0 rows. executeConfirmedAction therefore runs at most once, even if two
  // requests confirm the same id simultaneously (no duplicate send/delete).
  const { data: claimedRow, error: claimErr } = await db
    .from(TABLE)
    .update({ status: "confirmed", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("principal", principal)
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle();

  if (claimErr) throw new Error(`Failed to claim action: ${claimErr.message}`);
  // Not found / wrong principal / already resolved → return current state (null if absent).
  if (!claimedRow) return getPendingAction(id, principal);

  const claimed = toPendingAction(claimedRow as PendingRow);

  // We exclusively own the action now — run the side-effect exactly once.
  try {
    const outcome = await executeConfirmedAction(claimed.tool, claimed.args, principal);
    const { data } = await db
      .from(TABLE)
      .update({
        result: outcome.result as Record<string, unknown>,
        undo_data: outcome.undo_data,
      })
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();
    return data ? toPendingAction(data as PendingRow) : claimed;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    const { data } = await db
      .from(TABLE)
      .update({ status: "failed", result: { error: message } })
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();
    return data ? toPendingAction(data as PendingRow) : claimed;
  }
}

// ── Cancel ───────────────────────────────────────────────────

/**
 * Cancel a pending action — no side-effect. Status-guarded on `pending`, so
 * only an un-resolved action can be cancelled.
 */
export async function cancelAction(
  id: string,
  principal: string,
): Promise<PendingAction | null> {
  const db = supabaseAdmin();
  const existing = await getPendingAction(id, principal);
  if (!existing) return null;

  const { data, error } = await db
    .from(TABLE)
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("principal", principal)
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Failed to cancel action: ${error.message}`);
  // 0 rows → already resolved; surface current state.
  if (!data) return getPendingAction(id, principal);
  return toPendingAction(data as PendingRow);
}

// ── Undo ─────────────────────────────────────────────────────

/**
 * Reverse a reversible `confirmed` action (ADR-003 §5). Only `confirmed`
 * actions are undoable; the reversal is dispatched by tool using `undo_data`
 * captured at confirm time. On a successful reversal the row moves to `undone`.
 */
export async function undoAction(
  id: string,
  principal: string,
): Promise<{ action: PendingAction | null; undone: boolean; reason?: string }> {
  const db = supabaseAdmin();
  const action = await getPendingAction(id, principal);
  if (!action) return { action: null, undone: false, reason: "not found" };
  if (action.status !== "confirmed") {
    return { action, undone: false, reason: `cannot undo a ${action.status} action` };
  }

  const undo = action.undoData ?? {};

  switch (action.tool) {
    case "move_item": {
      const priorParentId = typeof undo.priorParentId === "string" ? undo.priorParentId : "";
      const itemId = typeof action.args.itemId === "string" ? action.args.itemId : "";
      if (!priorParentId || !itemId) {
        return { action, undone: false, reason: "prior location unavailable" };
      }
      const connId = await resolveConnectionId();
      await updateItem(connId, itemId, { newParentId: priorParentId });
      break;
    }

    case "rename_item": {
      const priorName = typeof undo.priorName === "string" ? undo.priorName : "";
      const itemId = typeof action.args.itemId === "string" ? action.args.itemId : "";
      if (!priorName || !itemId) {
        return { action, undone: false, reason: "prior name unavailable" };
      }
      const connId = await resolveConnectionId();
      await updateItem(connId, itemId, { newName: priorName });
      break;
    }

    case "delete_item": {
      // Graph delete moves the item to the recycle bin; there is no first-class
      // restore on the /me/drive surface. Best-effort: report unavailable so
      // the operator can restore from the recycle bin manually.
      return {
        action,
        undone: false,
        reason: "delete undo is unavailable — restore from the OneDrive recycle bin",
      };
    }

    case "schedule_email": {
      const scheduledId = typeof undo.scheduledId === "string" ? undo.scheduledId : "";
      if (!scheduledId) {
        return { action, undone: false, reason: "scheduled id unavailable" };
      }
      try {
        await cancelScheduled(scheduledId, principal);
      } catch {
        return { action, undone: false, reason: "scheduled email already sent or cancelled" };
      }
      break;
    }

    case "send_email":
      return { action, undone: false, reason: "send is irreversible" };

    case "record_finance_entry": {
      // Reverse a confirmed ledger entry by hard-deleting the row it created.
      const entryId =
        typeof undo.financeEntryId === "string" ? undo.financeEntryId : "";
      if (!entryId) {
        return { action, undone: false, reason: "finance entry id unavailable" };
      }
      await deleteFinanceEntry(entryId);
      break;
    }

    case "batch_move_to_trash":
    case "batch_move_to_folder": {
      // Reverse a confirmed batch move by moving the messages back to the source
      // folder. The dest UIDs come from the uidMap captured at confirm time
      // (source UID → dest UID); we move those dest UIDs from dest → source.
      const mailbox = typeof undo.mailbox === "string" ? undo.mailbox : "";
      const sourceFolderPath =
        typeof undo.sourceFolderPath === "string" ? undo.sourceFolderPath : "";
      const destFolderPath =
        typeof undo.destFolderPath === "string" ? undo.destFolderPath : "";
      const uidMap =
        undo.uidMap && typeof undo.uidMap === "object"
          ? (undo.uidMap as Record<string, number>)
          : {};
      const destUids = Object.values(uidMap).filter(
        (u): u is number => typeof u === "number" && Number.isFinite(u),
      );
      if (!mailbox || !sourceFolderPath || !destFolderPath) {
        return { action, undone: false, reason: "move metadata unavailable" };
      }
      if (destUids.length > 0) {
        // Fast path: server had UIDPLUS, so we know each message's new UID.
        await moveMessages(mailbox, destFolderPath, destUids, sourceFolderPath);
      } else {
        // §A1: no uidMap (server lacks UIDPLUS) — re-locate by Message-ID, which
        // survives a folder move, and move those messages back to the source.
        const messageIdMap =
          undo.messageIds && typeof undo.messageIds === "object"
            ? (undo.messageIds as Record<string, string>)
            : {};
        const messageIdValues = Object.values(messageIdMap).filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        );
        if (messageIdValues.length === 0) {
          return { action, undone: false, reason: "no moved messages to restore" };
        }
        await moveMessagesByMessageId(
          mailbox,
          destFolderPath,
          messageIdValues,
          sourceFolderPath,
        );
      }
      break;
    }

    // Both save_email_attachment and generate_invoice_from_template reverse by
    // deleting the uploaded item from OneDrive — they share the same undo path.
    case "save_email_attachment":
    case "generate_invoice_from_template": {
      const uploadedItemId = typeof undo.uploadedItemId === "string" ? undo.uploadedItemId : "";
      if (!uploadedItemId)
        return { action, undone: false, reason: "uploaded item id unavailable" };
      const connId = await resolveConnectionId();
      await deleteItemOnDrive(connId, uploadedItemId);
      break;
    }

    case "record_voyage_entry": {
      // Reverse by deleting the voyage_entries index row. The appended Excel row
      // is NOT auto-reverted — the confirm-card summary warned of this; manual
      // Excel cleanup is required. The DB-only undo mirrors the delete_item pattern.
      const entryId =
        typeof undo.voyageEntryId === "string" ? undo.voyageEntryId : "";
      if (!entryId) {
        return { action, undone: false, reason: "voyage entry id unavailable" };
      }
      await deleteVoyageEntry(entryId);
      break;
    }

    case "import_voyage_register": {
      // Reverse by hard-deleting every voyage_entries row that was inserted on
      // confirm. The undo_data carries the array of inserted ids captured at
      // confirm time. Fully idempotent — deleting a non-existent id is a no-op
      // in deleteVoyageEntry (Supabase delete on missing row returns no error).
      const ids = Array.isArray(undo.voyageEntryIds)
        ? undo.voyageEntryIds.filter((x): x is string => typeof x === "string")
        : [];
      for (const id of ids) {
        await deleteVoyageEntry(id);
      }
      break;
    }

    default:
      return { action, undone: false, reason: `no undo path for ${action.tool}` };
  }

  const { data, error } = await db
    .from(TABLE)
    .update({ status: "undone" })
    .eq("id", id)
    .eq("principal", principal)
    .eq("status", "confirmed")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Failed to record undo: ${error.message}`);
  if (!data) return { action: await getPendingAction(id, principal), undone: true };
  return { action: toPendingAction(data as PendingRow), undone: true };
}
