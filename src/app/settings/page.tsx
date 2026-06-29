"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";

/* ── Types ── */

interface NotificationPreferences {
  channel: string;
  enabled_events: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  push_subscription: Record<string, unknown> | null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/* ── VAPID key helper ── */

/**
 * Convert a base64url-encoded VAPID public key to a Uint8Array suitable
 * for `applicationServerKey` in PushManager.subscribe().
 * Standard helper included inline (no extra dep needed).
 */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

/* ── Permission state label ── */

type PermState = "default" | "granted" | "denied" | "unsupported";

/* ── Page component ── */

export default function Settings() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [permState, setPermState] = useState<PermState>("default");
  const [subscribing, setSubscribing] = useState(false);
  const [saving, setSaving] = useState(false);

  /* ── Detect push support + current permission on mount ── */
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setPermState("unsupported");
      return;
    }
    if (typeof Notification !== "undefined") {
      const current = Notification.permission;
      setPermState(current === "granted" ? "granted" : current === "denied" ? "denied" : "default");
    }
  }, []);

  /* ── Load preferences on mount ── */
  const fetchPrefs = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/notify/preferences");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const json = (await res.json()) as Envelope<NotificationPreferences>;
      if (!json.ok) throw new Error(json.error);
      setPrefs(json.data);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrefs();
  }, [fetchPrefs]);

  /* ── Enable push notifications (user gesture required) ── */
  async function enableNotifications() {
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setPermState("unsupported");
      return;
    }

    setSubscribing(true);
    setSaveError(null);
    setNotice(null);

    try {
      /* 1 — register the service worker */
      const registration = await navigator.serviceWorker.register("/sw.js");

      /* 2 — request OS permission */
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPermState("denied");
        setSubscribing(false);
        return;
      }
      setPermState("granted");

      /* 3 — subscribe to push */
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setSaveError("Push notifications are not configured on this server (missing VAPID key).");
        setSubscribing(false);
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      /* 4 — POST the subscription to the server */
      const res = await fetch("/api/notify/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const json = (await res.json()) as Envelope<unknown>;
      if (!json.ok) throw new Error((json as { ok: false; error: string }).error);

      setNotice("Push notifications enabled. You will be notified when an action is ready.");
      await fetchPrefs();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSubscribing(false);
    }
  }

  /* ── Toggle an event opt-in ── */
  async function toggleEvent(event: string) {
    if (!prefs) return;
    setSaveError(null);
    setNotice(null);
    setSaving(true);

    const current = prefs.enabled_events ?? [];
    const next = current.includes(event)
      ? current.filter((e) => e !== event)
      : [...current, event];

    try {
      const res = await fetch("/api/notify/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_events: next }),
      });
      const json = (await res.json()) as Envelope<NotificationPreferences>;
      if (!json.ok) throw new Error(json.error);
      setPrefs(json.data);
      setNotice("Preferences saved.");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /* ── Save quiet hours ── */
  async function saveQuietHours(start: string | null, end: string | null) {
    setSaveError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/notify/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiet_hours_start: start, quiet_hours_end: end }),
      });
      const json = (await res.json()) as Envelope<NotificationPreferences>;
      if (!json.ok) throw new Error(json.error);
      setPrefs(json.data);
      setNotice("Quiet hours saved.");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /* ── Quiet-hours local state (controlled inputs) ── */
  const [qStart, setQStart] = useState("");
  const [qEnd, setQEnd] = useState("");

  /* Sync inputs when prefs load */
  useEffect(() => {
    if (prefs) {
      setQStart(prefs.quiet_hours_start ?? "");
      setQEnd(prefs.quiet_hours_end ?? "");
    }
  }, [prefs]);

  /* ── Push-support banner ── */
  function renderPushBanner() {
    if (permState === "unsupported") {
      return (
        <div className="notice err" role="alert">
          <strong>Push notifications are not supported in this browser.</strong>
          {" "}On iOS, the app must be installed to the Home Screen first (iOS 16.4+ required
          for web-push on installed PWAs). On other platforms, try a modern browser such as
          Chrome or Edge.
        </div>
      );
    }
    if (permState === "denied") {
      return (
        <div className="notice err" role="alert">
          <strong>Notification permission was denied.</strong>
          {" "}To enable push notifications, reset the permission in your browser settings,
          then try again.{" "}
          <span>
            On iOS, the app must be installed to the Home Screen first (iOS 16.4+).
          </span>
        </div>
      );
    }
    if (permState === "granted" && prefs?.push_subscription) {
      return (
        <div className="notice ok" role="status">
          <BellRing size={15} strokeWidth={1.75} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "0.35em" }} />
          Push notifications are <strong>active</strong> on this device.
        </div>
      );
    }
    return null;
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>Aquavoy &middot; Settings</h1>
          <div className="tag">Notification preferences and quiet hours</div>
        </div>
      </div>

      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}
      {saveError && (
        <div className="notice err" role="alert">
          {saveError}
        </div>
      )}

      {loading ? (
        /* Loading skeleton — mirrors tasks/page.tsx skeleton pattern */
        <div aria-busy="true" aria-label="Loading settings" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {[0, 1].map((i) => (
            <div className="panel" key={i}>
              <div className="skeleton-row">
                <span className="skeleton icon" />
                <span className="skeleton" style={{ width: `${68 - i * 12}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="empty">
          <div>Couldn&apos;t load settings — {loadError}</div>
          <button
            className="btn ghost sm"
            style={{ marginTop: "var(--sp-3)" }}
            onClick={() => {
              setLoading(true);
              fetchPrefs();
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>

          {/* ── Push notifications ── */}
          <section
            className="panel"
            aria-labelledby="push-heading"
            style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <Bell size={18} strokeWidth={1.75} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
              <h2
                id="push-heading"
                className="panel-h"
                style={{ margin: 0 }}
              >
                Push Notifications
              </h2>
            </div>

            <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.9375rem", lineHeight: 1.6, maxWidth: "64ch" }}>
              Enable push notifications to receive an alert on this device when an action is ready to confirm —
              even when this tab is not open.
            </p>

            {renderPushBanner()}

            {permState !== "granted" || !prefs?.push_subscription ? (
              <div>
                <button
                  className="btn"
                  onClick={enableNotifications}
                  disabled={subscribing || permState === "denied" || permState === "unsupported"}
                  aria-busy={subscribing}
                >
                  <Bell size={15} strokeWidth={2} aria-hidden="true" />
                  {subscribing ? "Enabling…" : "Enable notifications"}
                </button>

                {permState === "default" && (
                  <p style={{ margin: "var(--sp-3) 0 0", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                    On iOS, the app must be installed to the Home Screen first (iOS 16.4+ required). Your browser will prompt for permission.
                  </p>
                )}
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", lineHeight: 1.5 }}>
                To disable, revoke permission in your browser settings. On iOS, notifications only work on the installed Home Screen PWA.
              </p>
            )}
          </section>

          {/* ── Event opt-ins ── */}
          <section
            className="panel"
            aria-labelledby="events-heading"
            style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}
          >
            <h2
              id="events-heading"
              className="panel-h"
              style={{ margin: 0 }}
            >
              Notify me when…
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {/* Stage event toggle */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-3)",
                  cursor: saving ? "not-allowed" : "pointer",
                  minHeight: "44px",
                  padding: "var(--sp-2) var(--sp-3)",
                  borderRadius: "var(--radius)",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  transition: "border-color 150ms",
                }}
              >
                <input
                  type="checkbox"
                  checked={prefs?.enabled_events?.includes("stage") ?? false}
                  onChange={() => toggleEvent("stage")}
                  disabled={saving}
                  aria-label="Notify when an action is ready to confirm"
                  style={{
                    width: "18px",
                    height: "18px",
                    flexShrink: 0,
                    accentColor: "var(--accent)",
                    cursor: saving ? "not-allowed" : "pointer",
                    minHeight: 0,
                  }}
                />
                <span>
                  <span style={{ fontWeight: 600, color: "var(--text)", fontSize: "0.9375rem" }}>
                    When an action is ready to confirm
                  </span>
                  <span style={{ display: "block", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", marginTop: "0.1rem" }}>
                    stage — fired every time a destructive action is staged for review
                  </span>
                </span>
              </label>
            </div>
          </section>

          {/* ── Quiet hours ── */}
          <section
            className="panel"
            aria-labelledby="quiet-heading"
            style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}
          >
            <h2
              id="quiet-heading"
              className="panel-h"
              style={{ margin: 0 }}
            >
              Quiet Hours
            </h2>

            <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "0.9375rem", lineHeight: 1.6, maxWidth: "64ch" }}>
              Suppress push notifications during a nightly window. Wrap-midnight ranges are supported
              (e.g. 22:00 &rarr; 07:00). Leave both fields empty to disable quiet hours.
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const start = qStart.trim() || null;
                const end = qEnd.trim() || null;
                await saveQuietHours(start, end);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
            >
              <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", flex: "1 1 10rem" }}>
                  <label
                    htmlFor="quiet-start"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Start
                  </label>
                  <input
                    id="quiet-start"
                    type="time"
                    value={qStart}
                    onChange={(e) => setQStart(e.target.value)}
                    placeholder="HH:MM"
                    aria-label="Quiet hours start time"
                    style={{ width: "100%" }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", flex: "1 1 10rem" }}>
                  <label
                    htmlFor="quiet-end"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    End
                  </label>
                  <input
                    id="quiet-end"
                    type="time"
                    value={qEnd}
                    onChange={(e) => setQEnd(e.target.value)}
                    placeholder="HH:MM"
                    aria-label="Quiet hours end time"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              {prefs?.quiet_hours_start && prefs.quiet_hours_end && (
                <div
                  className="notice ok"
                  role="status"
                  style={{ marginBottom: 0 }}
                >
                  Quiet from{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {prefs.quiet_hours_start}
                  </span>
                  {" "}to{" "}
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    {prefs.quiet_hours_end}
                  </span>
                  {" "}is active.
                </div>
              )}

              <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  className="btn"
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? "Saving…" : "Save quiet hours"}
                </button>
                {(prefs?.quiet_hours_start || prefs?.quiet_hours_end) && (
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={saving}
                    onClick={async () => {
                      setQStart("");
                      setQEnd("");
                      await saveQuietHours(null, null);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* ── No subscription empty state (not unsupported, just not subscribed) ── */}
          {permState === "default" && !prefs?.push_subscription && (
            <div className="empty">
              <Bell
                className="empty-icon"
                size={28}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              No push subscription yet.
              <span className="empty-hint">
                Enable notifications above to start receiving alerts on this device.
              </span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
