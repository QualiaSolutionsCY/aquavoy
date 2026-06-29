import { supabaseAdmin } from "@/lib/supabase/server";
import type { Principal } from "@/lib/openrouter/client";

/**
 * Preferences adapter for `notification_preferences` (ADR-008 §3).
 *
 * All Supabase access is via service-role — the table has RLS on with no
 * policies (0019_notifications.sql). Every query is scoped to the session
 * principal via `.eq("principal", principal)`, exactly like /api/actions/route.ts.
 *
 * isWithinQuietHours lives here because it is pure business logic that
 * belongs with the preferences model — the trigger imports it from here.
 */

const TABLE = "notification_preferences";
const LOG_TABLE = "notification_log";

const COLUMNS =
  "id, principal, channel, enabled_events, quiet_hours_start, quiet_hours_end, push_subscription, created_at, updated_at";

export interface NotificationPreferences {
  id: string;
  principal: string;
  channel: string;
  enabled_events: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  push_subscription: PushSubscriptionJSON | null;
  created_at: string;
  updated_at: string;
}

interface PrefsRow {
  id: string;
  principal: string;
  channel: string;
  enabled_events: string[] | unknown;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  push_subscription: PushSubscriptionJSON | null;
  created_at: string;
  updated_at: string;
}

function toPreferences(row: PrefsRow): NotificationPreferences {
  return {
    id: row.id,
    principal: row.principal,
    channel: row.channel,
    enabled_events: Array.isArray(row.enabled_events) ? (row.enabled_events as string[]) : ["stage"],
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    push_subscription: row.push_subscription,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Load the principal's notification preferences. If no row exists yet, creates
 * a default row (enabled_events: ["stage"], channel: webpush, no quiet hours)
 * and returns it. Default matches ADR-008 §1: stage notifications on by default.
 */
export async function loadPreferences(
  principal: Principal,
): Promise<NotificationPreferences> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("principal", principal)
    .maybeSingle();

  if (error) throw new Error(`Failed to load preferences: ${error.message}`);

  if (data) return toPreferences(data as PrefsRow);

  // No row exists — create default.
  const { data: created, error: insertErr } = await db
    .from(TABLE)
    .insert({
      principal,
      channel: "webpush",
      enabled_events: ["stage"],
    })
    .select(COLUMNS)
    .single();

  if (insertErr) throw new Error(`Failed to create default preferences: ${insertErr.message}`);
  return toPreferences(created as PrefsRow);
}

export type PrefsPatch = {
  channel?: string;
  enabled_events?: string[];
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  push_subscription?: PushSubscriptionJSON | null;
};

/**
 * Upsert a patch for the principal's preferences. Only the provided fields are
 * updated — unset fields retain their DB values (Supabase upsert merges).
 */
export async function savePreferences(
  principal: Principal,
  patch: PrefsPatch,
): Promise<NotificationPreferences> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      { principal, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "principal" },
    )
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to save preferences: ${error.message}`);
  return toPreferences(data as PrefsRow);
}

/**
 * Null out the push subscription for the principal (called after a 410/404 to
 * clear the stale endpoint so it is not retried on the next send).
 */
export async function clearExpiredSubscription(principal: Principal): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from(TABLE)
    .update({ push_subscription: null, updated_at: new Date().toISOString() })
    .eq("principal", principal);

  if (error) {
    // Best-effort — log but do not throw; called from a fire-and-forget context.
    console.error(`[notify] clearExpiredSubscription failed for ${principal}: ${error.message}`);
  }
}

/**
 * Log a notification send attempt to `notification_log`. Best-effort — never
 * throws. The 90-day retention window is enforced at query time (no DB cron).
 */
export async function logNotification(entry: {
  principal: Principal;
  channel: string;
  event: string;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = supabaseAdmin();
    await db.from(LOG_TABLE).insert({
      principal: entry.principal,
      channel: entry.channel,
      event: entry.event,
      error: entry.error ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch {
    // Logging must never throw.
  }
}

/**
 * Returns true when `now` falls within the [start, end) quiet-hours window.
 *
 * - null start or end → false (no quiet hours configured).
 * - Times are "HH:MM" strings (as stored in Postgres `time` columns).
 * - Wrap-midnight: when start > end (e.g. "22:00" – "07:00"), the quiet
 *   window spans midnight: quiet when `mins >= start OR mins < end`.
 * - Non-wrap: quiet when `start <= mins < end`.
 */
export function isWithinQuietHours(
  now: Date,
  start: string | null,
  end: string | null,
): boolean {
  if (!start || !end) return false;

  function toMinutes(hhmm: string): number {
    const [hStr, mStr] = hhmm.split(":");
    return parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = toMinutes(start);
  const endMins = toMinutes(end);

  if (startMins <= endMins) {
    // Simple range: e.g. "09:00" to "18:00"
    return nowMins >= startMins && nowMins < endMins;
  } else {
    // Wrap-midnight: e.g. "22:00" to "07:00"
    return nowMins >= startMins || nowMins < endMins;
  }
}
