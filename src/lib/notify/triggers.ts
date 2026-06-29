import type { Principal } from "@/lib/openrouter/client";
import { webPushChannel } from "@/lib/notify/webpush";
import type { NotifyMessage } from "@/lib/notify/adapter";
import {
  loadPreferences,
  clearExpiredSubscription,
  isWithinQuietHours,
  logNotification,
} from "@/lib/notify/preferences";

/**
 * Fire-and-forget notification trigger (ADR-008 §2).
 *
 * Called by stagePendingAction after a row inserts — NEVER throws. Any error
 * (DB, network, expired subscription) is caught, logged best-effort, and
 * silently swallowed. A delivery failure must NEVER fail the staging insert
 * (ADR-003 invariant: the insert is the confirm-gate).
 *
 * No dependency on pendingActions.ts — that would create a cycle. This module
 * receives only the minimal { summary } shape it needs from the caller.
 */
export async function notifyOnStage(
  principal: Principal,
  action: { summary: string },
): Promise<void> {
  try {
    const prefs = await loadPreferences(principal);

    // Gate 1: subscription registered?
    if (!prefs.push_subscription) return;

    // Gate 2: "stage" event opted-in?
    if (!prefs.enabled_events.includes("stage")) return;

    // Gate 3: not within quiet hours?
    if (isWithinQuietHours(new Date(), prefs.quiet_hours_start, prefs.quiet_hours_end)) return;

    const message: NotifyMessage = {
      title: "Action ready to confirm",
      body: action.summary,
      url: "/",
    };

    const result = await webPushChannel.send(principal, message, prefs.push_subscription);

    if (result.expired) {
      // Stale subscription (HTTP 410/404) — clear it so it is not retried.
      await clearExpiredSubscription(principal);
      await logNotification({
        principal,
        channel: prefs.channel,
        event: "stage",
        error: "subscription expired — cleared",
        metadata: { endpoint: (prefs.push_subscription as { endpoint?: string }).endpoint },
      });
      return;
    }

    await logNotification({
      principal,
      channel: prefs.channel,
      event: "stage",
      error: result.ok ? undefined : (result.error ?? "send failed"),
      metadata: { ok: result.ok },
    });
  } catch (err) {
    // Catch-all: best-effort log, then return. Never re-throw (ADR-003 / ADR-008).
    const message = err instanceof Error ? err.message : String(err);
    try {
      await logNotification({
        principal,
        channel: "webpush",
        event: "stage",
        error: `trigger error: ${message}`,
      });
    } catch {
      // If even the log fails, swallow it — we must not throw.
    }
  }
}
