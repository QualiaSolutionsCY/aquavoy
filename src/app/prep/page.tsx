"use client";

import { useEffect, useState } from "react";

interface Recipient {
  id: string;
  name: string;
  email: string;
  role: string | null;
  notes: string | null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as Envelope<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

export default function Prep() {
  const [crew, setCrew] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [crewError, setCrewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // add-recipient form
  const [form, setForm] = useState({ name: "", email: "", role: "", notes: "" });

  // compose
  const [intent, setIntent] = useState("");
  const [web, setWeb] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  async function loadCrew() {
    try {
      setCrew(await api<Recipient[]>("/api/recipients"));
      setCrewError(null);
    } catch (e) {
      setCrewError(
        `${(e as Error).message} — recipients need Supabase configured. Add the creds and redeploy.`,
      );
    }
  }
  useEffect(() => {
    loadCrew();
  }, []);

  async function addRecipient() {
    if (!form.name || !form.email) return;
    try {
      await api<Recipient>("/api/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ name: "", email: "", role: "", notes: "" });
      setNotice(`Added ${form.name}`);
      loadCrew();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeRecipient(id: string) {
    try {
      await api(`/api/recipients?id=${id}`, { method: "DELETE" });
      if (selected?.id === id) setSelected(null);
      loadCrew();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function draft() {
    if (!selected || !intent.trim()) return;
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const d = await api<{ subject: string; body: string }>("/api/outlook/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: selected, intent, web }),
      });
      setSubject(d.subject);
      setBodyText(d.body);
      setNotice("Draft ready. Review and edit before sending.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function pushToOutlook(mode: "draft" | "send") {
    if (!selected || !subject || !bodyText) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ sent?: boolean; draft?: boolean; webLink?: string }>(
        "/api/outlook/send",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: selected.email, subject, body: bodyText, mode }),
        },
      );
      setNotice(
        r.sent
          ? `Sent to ${selected.email}`
          : `Saved to Outlook Drafts${r.webLink ? "" : ""}.`,
      );
    } catch (e) {
      setError(
        `${(e as Error).message} — sending needs a connected Microsoft account (Azure app creds).`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>1:1 Email Prep</h1>
          <div className="tag">Draft, review, send via Outlook</div>
        </div>
      </div>

      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice ok" role="status">
          {notice}
        </div>
      )}

      <div className="prep-grid">
        {/* ── Crew column ── */}
        <section className="panel">
          <h2 className="panel-h">Crew</h2>
          {crewError && <div className="notice err">{crewError}</div>}
          <div className="crew-list">
            {crew.length === 0 && !crewError ? (
              <div className="empty">No recipients yet. Add one below.</div>
            ) : (
              crew.map((r) => (
                <div
                  key={r.id}
                  className={`crew-item ${selected?.id === r.id ? "active" : ""}`}
                  onClick={() => setSelected(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(r)}
                  aria-pressed={selected?.id === r.id}
                >
                  <div className="crew-name">{r.name}</div>
                  <div className="meta">{r.email}</div>
                  {r.role && <div className="meta">{r.role}</div>}
                  <button
                    className="btn danger sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecipient(r.id);
                    }}
                    aria-label={`Remove ${r.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="add-form">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              aria-label="Recipient name"
            />
            <input
              placeholder="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              aria-label="Recipient email"
            />
            <input
              placeholder="Role (optional)"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              aria-label="Recipient role"
            />
            <input
              placeholder="Context / notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              aria-label="Additional context"
            />
            <button className="btn" onClick={addRecipient} disabled={!form.name || !form.email}>
              + Add to crew
            </button>
          </div>
        </section>

        {/* ── Compose column ── */}
        <section className="panel">
          <h2 className="panel-h">
            {selected ? `Prepare email to ${selected.name}` : "Select a recipient"}
          </h2>
          {!selected ? (
            <div className="empty">Pick someone from the crew to prepare their 1:1 email.</div>
          ) : (
            <>
              <label className="lbl" htmlFor="intent-field">
                What should this email achieve?
              </label>
              <textarea
                id="intent-field"
                className="intent"
                rows={3}
                placeholder={`e.g. Check in with ${selected.name} about the Q3 rollout and propose a call next week.`}
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              />
              <div className="row" style={{ margin: "0.75rem 0" }}>
                <button
                  className={`web-toggle ${web ? "on" : ""}`}
                  onClick={() => setWeb((w) => !w)}
                  aria-pressed={web}
                  aria-label={`Web search ${web ? "enabled" : "disabled"}`}
                >
                  Web {web ? "on" : "off"}
                </button>
                <button className="btn" onClick={draft} disabled={drafting || !intent.trim()}>
                  {drafting ? "Drafting…" : "Draft with AI"}
                </button>
              </div>

              <label className="lbl" htmlFor="subject-field">
                Subject
              </label>
              <input
                id="subject-field"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />

              <label className="lbl" htmlFor="body-field">
                Body
              </label>
              <textarea
                id="body-field"
                className="body"
                rows={12}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />

              <div className="row" style={{ marginTop: "1rem" }}>
                <button
                  className="btn ghost"
                  onClick={() => pushToOutlook("draft")}
                  disabled={sending || !subject || !bodyText}
                >
                  Save to Outlook Drafts
                </button>
                <button
                  className="btn"
                  onClick={() => pushToOutlook("send")}
                  disabled={sending || !subject || !bodyText}
                >
                  {sending ? "…" : "Send via Outlook"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
