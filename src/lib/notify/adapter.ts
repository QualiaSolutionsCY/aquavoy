import type { Principal } from "@/lib/openrouter/client";

/**
 * Vendor-agnostic notification message. Passed to every channel impl.
 */
export type NotifyMessage = {
  title: string;
  body: string;
  url?: string;
};

/**
 * Vendor-agnostic channel contract (ADR-008 §2).
 *
 * Any notification channel (web-push, a future messaging channel, email-digest)
 * implements this interface so the trigger layer is never coupled to a vendor.
 * Adding a second channel is one new file implementing this interface — not a refactor.
 */
export interface NotificationChannel {
  /** Human-readable name for logging (e.g. "webpush"). */
  name: string;
  /**
   * Attempt to deliver a notification.
   *
   * Must NEVER throw — callers rely on a resolved Promise.
   * Returns { ok: true } on success.
   * Returns { ok: false, expired: true } when the subscription is stale (HTTP 410/404).
   * Returns { ok: false, error: string } for any other failure.
   */
  send(
    principal: Principal,
    message: NotifyMessage,
    subscription: PushSubscriptionJSON,
  ): Promise<{ ok: boolean; expired?: boolean; error?: string }>;
}

/**
 * Thin dispatch helper — keeps trigger code from importing a channel directly.
 * Calls channel.send and passes the result through unchanged.
 */
export async function dispatch(
  channel: NotificationChannel,
  principal: Principal,
  message: NotifyMessage,
  subscription: PushSubscriptionJSON,
): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
  return channel.send(principal, message, subscription);
}
