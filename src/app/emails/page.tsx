"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MAILBOXES, GROUPS, DOMAIN_DEFAULTS } from "@/lib/mailboxes";

/* ── API types (contract with backend agent) ── */

interface MailAccount {
  id: string;
  email: string;
  displayName: string | null;
  smtpHost: string;
  smtpPort: number;
  imapHost: string | null;
  imapPort: number | null;
  username: string;
  verifiedAt: string | null;
}

interface ScheduledEmail {
  id: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  scheduledAt: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/* ── Form state for connecting a mailbox ── */

interface ConnectForm {
  email: string;
  password: string;
  username: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

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

function makeForm(email: string, group: "aquavoy.com" | "faialbv.com"): ConnectForm {
  const defaults = DOMAIN_DEFAULTS[group];
  return {
    email,
    password: "",
    username: email,
    displayName: "",
    smtpHost: defaults.smtpHost,
    smtpPort: defaults.smtpPort,
    imapHost: defaults.imapHost,
    imapPort: defaults.imapPort,
  };
}

export default function Emails() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* Which mailbox has its form open (address string, or null) */
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* Disconnect confirmation */
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  /* Scheduled emails state */
  const [scheduled, setScheduled] = useState<ScheduledEmail[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(true);
  const [scheduledError, setScheduledError] = useState<string | null>(null);

  const fetchScheduled = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/scheduled");
      if (!res.ok) {
        if (res.status === 404) {
          setScheduled([]);
          return;
        }
        throw new Error(`Server responded ${res.status}`);
      }
      const json = (await res.json()) as Envelope<ScheduledEmail[]>;
      if (!json.ok) throw new Error(json.error);
      setScheduled(json.data);
    } catch (e) {
      setScheduledError((e as Error).message);
    } finally {
      setScheduledLoading(false);
    }
  }, []);

  async function cancelScheduledEmail(id: string) {
    if (!confirm("Cancel this scheduled email?")) return;
    try {
      const res = await fetch(`/api/mail/scheduled?id=${id}`, { method: "DELETE" });
      const json = (await res.json()) as Envelope<unknown>;
      if (!json.ok) throw new Error((json as { ok: false; error: string }).error);
      setNotice("Scheduled email cancelled.");
      await fetchScheduled();
    } catch (e) {
      setScheduledError((e as Error).message);
    }
  }

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/mail/accounts");
      if (!res.ok) {
        // Backend may not be deployed yet -- treat 404 as empty
        if (res.status === 404) {
          setAccounts([]);
          return;
        }
        throw new Error(`Server responded ${res.status}`);
      }
      const json = (await res.json()) as Envelope<MailAccount[]>;
      if (!json.ok) throw new Error(json.error);
      setAccounts(json.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function load() {
      await Promise.all([fetchAccounts(), fetchScheduled()]);
    }
    load();
  }, [fetchAccounts, fetchScheduled]);

  function findAccount(address: string): MailAccount | undefined {
    return accounts.find((a) => a.email.toLowerCase() === address.toLowerCase());
  }

  function openConnectForm(email: string, group: "aquavoy.com" | "faialbv.com") {
    setOpenForm(email);
    setForm(makeForm(email, group));
    setFormError(null);
    setShowAdvanced(false);
  }

  function closeForm() {
    setOpenForm(null);
    setForm(null);
    setFormError(null);
    setSubmitting(false);
    setShowAdvanced(false);
  }

  async function submitConnect() {
    if (!form || !form.password) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/mail/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          displayName: form.displayName || undefined,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
          imapHost: form.imapHost,
          imapPort: form.imapPort,
          username: form.username,
          password: form.password,
        }),
      });
      const json = (await res.json()) as Envelope<MailAccount>;
      if (!json.ok) throw new Error(json.error);
      setNotice(`Connected ${form.email}`);
      closeForm();
      await fetchAccounts();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnect(id: string, email: string) {
    try {
      const res = await fetch(`/api/mail/accounts?id=${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const json = (await res.json()) as Envelope<unknown>;
        if (!json.ok) throw new Error(json.error);
      }
      setNotice(`Disconnected ${email}`);
      setConfirmDisconnect(null);
      await fetchAccounts();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateForm(patch: Partial<ConnectForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>Aquavoy &middot; Emails</h1>
          <div className="tag">Connect company mailboxes via IMAP / SMTP</div>
        </div>
        <div className="row">
          <Link className="btn ghost" href="/">
            &larr; Chat
          </Link>
          <Link className="btn ghost" href="/files">
            Files &rarr;
          </Link>
        </div>
      </div>

      {error && <div className="notice err" role="alert">{error}</div>}
      {notice && <div className="notice ok" role="status">{notice}</div>}

      {loading ? (
        <div className="list" aria-busy="true" aria-label="Loading mail accounts">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div className="skeleton-row" key={i}>
              <span className="skeleton icon" />
              <span className="skeleton" style={{ width: `${72 - i * 8}%` }} />
              <span className="skeleton meta" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <div>Could not load — Retry</div>
          <button
            className="btn ghost sm"
            style={{ marginTop: "var(--sp-3)" }}
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchAccounts();
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        GROUPS.map((group) => (
          <section key={group} style={{ marginBottom: "2rem" }}>
            <h2
              style={{
                fontSize: "0.78rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-dim)",
                margin: "0 0 0.6rem",
              }}
            >
              {group}
            </h2>
            <div className="list">
              {MAILBOXES.filter((m) => m.group === group).map((mailbox) => {
                const acct = findAccount(mailbox.address);
                const isFormOpen = openForm === mailbox.address;

                return (
                  <div key={mailbox.address}>
                    <div
                      className="item"
                      style={{ gridTemplateColumns: "1fr auto auto" }}
                    >
                      <span className="name">{mailbox.address}</span>

                      {acct ? (
                        <>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              padding: "0.2rem 0.55rem",
                              borderRadius: "var(--radius)",
                              background: "oklch(0.4 0.08 160 / 0.35)",
                              color: "oklch(0.82 0.12 160)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Connected
                            {acct.displayName ? ` — ${acct.displayName}` : ""}
                          </span>
                          <div className="row" style={{ gap: "0.35rem" }}>
                            <button
                              className="btn ghost sm"
                              onClick={() => openConnectForm(mailbox.address, mailbox.group)}
                            >
                              Re-verify
                            </button>
                            {confirmDisconnect === mailbox.address ? (
                              <div className="row" style={{ gap: "0.25rem" }}>
                                <button
                                  className="btn danger sm"
                                  onClick={() => disconnect(acct.id, acct.email)}
                                >
                                  Confirm
                                </button>
                                <button
                                  className="btn ghost sm"
                                  onClick={() => setConfirmDisconnect(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn danger sm"
                                onClick={() => setConfirmDisconnect(mailbox.address)}
                              >
                                Disconnect
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.2rem 0.55rem",
                              borderRadius: "var(--radius)",
                              background: "oklch(0.3 0.04 240 / 0.5)",
                              color: "var(--text-dim)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Not connected
                          </span>
                          <button
                            className="btn sm"
                            onClick={() =>
                              isFormOpen
                                ? closeForm()
                                : openConnectForm(mailbox.address, mailbox.group)
                            }
                          >
                            {isFormOpen ? "Cancel" : "Connect"}
                          </button>
                        </>
                      )}
                    </div>

                    {/* ── Inline connect / re-verify form ── */}
                    {isFormOpen && form && (
                      <div
                        style={{
                          padding: "var(--sp-4)",
                          background: "var(--bg-subtle)",
                          borderBottom: "1px solid var(--border-subtle)",
                        }}
                      >
                        {formError && (
                          <div className="notice err" role="alert" style={{ marginBottom: "var(--sp-3)" }}>
                            {formError}
                          </div>
                        )}

                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                          <div>
                            <label className="lbl" htmlFor={`pw-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                              Password
                            </label>
                            <input
                              id={`pw-${mailbox.address}`}
                              type="password"
                              autoComplete="current-password"
                              value={form.password}
                              onChange={(e) => updateForm({ password: e.target.value })}
                              placeholder="Mailbox password"
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div>
                            <label className="lbl" htmlFor={`user-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                              Username
                            </label>
                            <input
                              id={`user-${mailbox.address}`}
                              type="text"
                              value={form.username}
                              onChange={(e) => updateForm({ username: e.target.value })}
                              placeholder={mailbox.address}
                              style={{ width: "100%" }}
                            />
                          </div>

                          <div>
                            <label className="lbl" htmlFor={`dn-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                              Display name (optional)
                            </label>
                            <input
                              id={`dn-${mailbox.address}`}
                              type="text"
                              value={form.displayName}
                              onChange={(e) => updateForm({ displayName: e.target.value })}
                              placeholder="e.g. Aquavoy Info"
                              style={{ width: "100%" }}
                            />
                          </div>

                          {/* Advanced server settings */}
                          <button
                            type="button"
                            onClick={() => setShowAdvanced((v) => !v)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--text-dim)",
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              fontFamily: "var(--font-mono)",
                              padding: "0",
                              textAlign: "left",
                            }}
                          >
                            {showAdvanced ? "▼" : "▶"} Server settings
                          </button>

                          {showAdvanced && (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr auto",
                                gap: "var(--sp-2)",
                                padding: "var(--sp-3)",
                                background: "var(--surface)",
                                borderRadius: "var(--radius)",
                                border: "1px solid var(--border-subtle)",
                              }}
                            >
                              <div>
                                <label className="lbl" htmlFor={`smtp-host-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                                  SMTP Host
                                </label>
                                <input
                                  id={`smtp-host-${mailbox.address}`}
                                  type="text"
                                  value={form.smtpHost}
                                  onChange={(e) => updateForm({ smtpHost: e.target.value })}
                                  style={{ width: "100%" }}
                                />
                              </div>
                              <div>
                                <label className="lbl" htmlFor={`smtp-port-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                                  SMTP Port
                                </label>
                                <input
                                  id={`smtp-port-${mailbox.address}`}
                                  type="number"
                                  value={form.smtpPort}
                                  onChange={(e) => updateForm({ smtpPort: Number(e.target.value) })}
                                  style={{ width: "80px" }}
                                />
                              </div>
                              <div>
                                <label className="lbl" htmlFor={`imap-host-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                                  IMAP Host
                                </label>
                                <input
                                  id={`imap-host-${mailbox.address}`}
                                  type="text"
                                  value={form.imapHost}
                                  onChange={(e) => updateForm({ imapHost: e.target.value })}
                                  style={{ width: "100%" }}
                                />
                              </div>
                              <div>
                                <label className="lbl" htmlFor={`imap-port-${mailbox.address}`} style={{ margin: "0 0 var(--sp-1)" }}>
                                  IMAP Port
                                </label>
                                <input
                                  id={`imap-port-${mailbox.address}`}
                                  type="number"
                                  value={form.imapPort}
                                  onChange={(e) => updateForm({ imapPort: Number(e.target.value) })}
                                  style={{ width: "80px" }}
                                />
                              </div>
                            </div>
                          )}

                          <div className="row" style={{ gap: "var(--sp-2)" }}>
                            <button
                              className="btn"
                              disabled={submitting || !form.password}
                              onClick={submitConnect}
                            >
                              {submitting ? "Verifying SMTP login…" : "Verify & Connect"}
                            </button>
                            <button className="btn ghost" onClick={closeForm}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {/* ── Scheduled emails panel ── */}
      <section className="panel" style={{ marginTop: "2rem" }}>
        <h2 className="panel-h">Scheduled Emails</h2>

        {scheduledLoading ? (
          <div className="list" aria-busy="true" aria-label="Loading scheduled emails">
            {[0, 1, 2, 3].map((i) => (
              <div className="skeleton-row" key={i}>
                <span className="skeleton icon" />
                <span className="skeleton" style={{ width: `${70 - i * 9}%` }} />
                <span className="skeleton meta" />
              </div>
            ))}
          </div>
        ) : scheduledError ? (
          <div className="empty">
            <div>Could not load — Retry</div>
            <button
              className="btn ghost sm"
              style={{ marginTop: "var(--sp-3)" }}
              onClick={() => {
                setScheduledError(null);
                setScheduledLoading(true);
                fetchScheduled();
              }}
            >
              Retry
            </button>
          </div>
        ) : scheduled.length === 0 ? (
          <div className="empty">Ask the agent to list your emails</div>
        ) : (
          <div className="list">
            {scheduled.map((item) => (
              <div
                key={item.id}
                className="item"
                style={{ gridTemplateColumns: "1fr auto auto" }}
              >
                <div>
                  <span className="name">
                    {item.fromEmail} &rarr; {item.toEmail}
                  </span>
                  <span className="meta">
                    {item.subject} &middot; {fmtAmsterdam(item.scheduledAt)}
                  </span>
                  {item.error && (
                    <span className="meta" style={{ color: "oklch(0.82 0.10 25)" }}>
                      {item.error}
                    </span>
                  )}
                </div>
                <span className={`badge ${STATUS_BADGE[item.status] ?? "muted"}`}>
                  {item.status}
                </span>
                {item.status === "pending" && (
                  <button
                    className="btn danger sm"
                    onClick={() => cancelScheduledEmail(item.id)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
