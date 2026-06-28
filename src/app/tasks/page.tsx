"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

/* ── API types (contract with /api/tasks/list) ── */

type TaskItem =
  | {
      kind: "reminder";
      id: string;
      status: "pending" | "sent" | "failed" | "cancelled";
      scheduledAt: string;
      recurrence: "none" | "daily" | "weekly" | "monthly" | null | undefined;
      mailbox: string;
      title: string;
      error: string | null;
    }
  | {
      kind: "email";
      id: string;
      status: "pending" | "sent" | "failed" | "cancelled";
      scheduledAt: string;
      recurrence: "none" | "daily" | "weekly" | "monthly" | null | undefined;
      fromEmail: string;
      toEmail: string;
      subject: string;
      error: string | null;
    };

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/* ── Helpers (locality over shared util) ── */

function fmtAmsterdam(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const STATUS_BADGE: Record<string, string> = {
  pending: "muted",
  sent: "ok",
  failed: "err",
  cancelled: "muted",
};

const RECURRENCE_MAP: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/* Defensive: missing / "none" / unknown → "One-time" */
function recurrenceLabel(
  recurrence: "none" | "daily" | "weekly" | "monthly" | null | undefined,
): string {
  return (recurrence && RECURRENCE_MAP[recurrence]) ?? "One-time";
}

/* ── Page component ── */

export default function Tasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/tasks/list");
      if (!res.ok) {
        if (res.status === 404) {
          setTasks([]);
          return;
        }
        throw new Error(`Server responded ${res.status}`);
      }
      const json = (await res.json()) as Envelope<TaskItem[]>;
      if (!json.ok) throw new Error(json.error);
      setTasks(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  async function cancelItem(item: TaskItem) {
    if (!confirm("Cancel this?")) return;
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/tasks/cancel?id=${encodeURIComponent(item.id)}&kind=${item.kind}`,
        { method: "DELETE" },
      );
      const json = (await res.json()) as Envelope<unknown>;
      if (!json.ok) throw new Error((json as { ok: false; error: string }).error);
      setNotice("Task cancelled.");
      await fetchTasks();
    } catch (e) {
      setCancelError((e as Error).message);
    }
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>Aquavoy &middot; Tasks</h1>
          <div className="tag">Reminders and scheduled emails the agent has queued</div>
        </div>
      </div>

      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}
      {cancelError && (
        <div className="notice err" role="alert">
          {cancelError}
        </div>
      )}

      {loading ? (
        <div className="list" aria-busy="true" aria-label="Loading tasks">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton icon" />
              <span className="skeleton" style={{ width: `${72 - i * 9}%` }} />
              <span className="skeleton meta" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <div>Couldn&apos;t load the task queue — {error}</div>
          <button
            className="btn ghost sm"
            style={{ marginTop: "var(--sp-3)" }}
            onClick={() => {
              setLoading(true);
              fetchTasks();
            }}
          >
            Retry
          </button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="empty">
          <CalendarClock
            className="empty-icon"
            size={28}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          Nothing scheduled.
          <span className="empty-hint">
            Ask the agent to set a reminder or schedule an email.
          </span>
        </div>
      ) : (
        <div className="list">
          {tasks.map((item) => (
            <div
              key={`${item.kind}-${item.id}`}
              className="item"
              style={{ gridTemplateColumns: "1fr auto auto" }}
            >
              <div>
                {item.kind === "reminder" ? (
                  <>
                    <span className="name">&#128276; {item.title}</span>
                    <span className="meta">
                      {item.mailbox} &middot; {fmtAmsterdam(item.scheduledAt)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="name">&#9993;&#65039; {item.subject}</span>
                    <span className="meta">
                      {item.fromEmail} &rarr; {item.toEmail} &middot;{" "}
                      {fmtAmsterdam(item.scheduledAt)}
                    </span>
                  </>
                )}
                {item.error && (
                  <span
                    className="meta"
                    style={{ color: "var(--danger)" }}
                  >
                    {item.error}
                  </span>
                )}
              </div>

              <div className="row" style={{ gap: "0.35rem" }}>
                <span className="badge muted">{recurrenceLabel(item.recurrence)}</span>
                <span className={`badge ${STATUS_BADGE[item.status] ?? "muted"}`}>
                  {item.status}
                </span>
              </div>

              {item.status === "pending" && (
                <button
                  className="btn danger sm"
                  onClick={() => cancelItem(item)}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
