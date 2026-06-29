import webpush from "web-push";
import type { Principal } from "@/lib/openrouter/client";
import { getVapidEnv } from "@/lib/env";
import type { NotificationChannel, NotifyMessage } from "./adapter";

/**
 * Web-push implementation of the vendor-agnostic NotificationChannel (adapter).
 *
 * ADR-008 §2: this file is the ONLY place with web-push-specific knowledge;
 * the trigger layer calls it through the `NotificationChannel` interface.
 *
 * Error contract: send() must NEVER throw. It catches all errors and maps them:
 *   - WebPushError statusCode 410 or 404 → { ok: false, expired: true }  (stale sub)
 *   - Any other error                    → { ok: false, error: string }
 *   - Missing VAPID keys                 → { ok: false, error: "web-push not configured" }
 *   - Success                            → { ok: true }
 */
export const webPushChannel: NotificationChannel = {
  name: "webpush",

  async send(
    _principal: Principal,
    message: NotifyMessage,
    subscription: PushSubscriptionJSON,
  ): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
    const env = getVapidEnv();
    if (!env) {
      return { ok: false, error: "web-push not configured" };
    }

    try {
      webpush.setVapidDetails(
        env.VAPID_SUBJECT,
        env.VAPID_PUBLIC_KEY!,
        env.VAPID_PRIVATE_KEY!,
      );

      await webpush.sendNotification(
        subscription as webpush.PushSubscription,
        JSON.stringify(message),
      );

      return { ok: true };
    } catch (err: unknown) {
      // WebPushError carries statusCode on the error object.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        return { ok: false, expired: true };
      }
      const message =
        err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  },
};
