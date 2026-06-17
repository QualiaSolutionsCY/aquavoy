import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveConnectionId } from "@/lib/microsoft/connections";
import { updateItem } from "@/lib/microsoft/onedrive";
import { cancelScheduled } from "@/lib/mail/scheduled";
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
  const pending = await getPendingAction(id, principal);
  if (!pending) return null;
  if (pending.status !== "pending") return pending;

  let outcome;
  try {
    outcome = await executeConfirmedAction(pending.tool, pending.args, principal);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    const { data } = await db
      .from(TABLE)
      .update({
        status: "failed",
        resolved_at: new Date().toISOString(),
        result: { error: message },
      })
      .eq("id", id)
      .eq("principal", principal)
      .eq("status", "pending")
      .select(COLUMNS)
      .maybeSingle();
    if (data) return toPendingAction(data as PendingRow);
    // Lost the race (already resolved) — return the current row.
    return getPendingAction(id, principal);
  }

  const { data, error } = await db
    .from(TABLE)
    .update({
      status: "confirmed",
      resolved_at: new Date().toISOString(),
      result: outcome.result as Record<string, unknown>,
      undo_data: outcome.undo_data,
    })
    .eq("id", id)
    .eq("principal", principal)
    .eq("status", "pending")
    .select(COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Failed to record confirmation: ${error.message}`);
  // 0 rows → another request already confirmed it; return the current state.
  if (!data) return getPendingAction(id, principal);
  return toPendingAction(data as PendingRow);
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
        await cancelScheduled(scheduledId);
      } catch {
        return { action, undone: false, reason: "scheduled email already sent or cancelled" };
      }
      break;
    }

    case "send_email":
      return { action, undone: false, reason: "send is irreversible" };

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
