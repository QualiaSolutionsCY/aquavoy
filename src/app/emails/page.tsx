"use client";

import { useEffect, useState } from "react";
import { MAILBOXES, GROUPS } from "@/lib/mailboxes";

interface Connection {
  id: string;
  msUserId: string;
  displayName: string | null;
  userPrincipalName: string | null;
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export default function Emails() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // Handle OAuth redirect params (?connected=...&error=...)
    const url = new URL(window.location.href);
    const errParam = url.searchParams.get("error");
    const connectedParam = url.searchParams.get("connected");
    if (errParam) setError(errParam);
    if (connectedParam) setNotice("Microsoft account connected.");
    if (errParam || connectedParam) {
      window.history.replaceState({}, "", url.pathname);
    }

    // Fetch connections
    fetch("/api/onedrive/connections")
      .then((res) => res.json() as Promise<Envelope<Connection[]>>)
      .then((json) => {
        if (!json.ok) throw new Error(json.error);
        setConnections(json.data);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function findConnection(address: string): Connection | undefined {
    return connections.find(
      (c) =>
        c.userPrincipalName !== null &&
        c.userPrincipalName.toLowerCase() === address.toLowerCase(),
    );
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>Aquavoy &middot; Emails</h1>
          <div className="tag">Connect company mailboxes via Microsoft OAuth</div>
        </div>
        <div className="row">
          <a className="btn ghost" href="/">
            &larr; Chat
          </a>
          <a className="btn ghost" href="/files">
            Files &rarr;
          </a>
        </div>
      </div>

      {error && <div className="notice err">{error}</div>}
      {notice && <div className="notice ok">{notice}</div>}

      {loading ? (
        <div className="empty">Loading connections&hellip;</div>
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
                const conn = findConnection(mailbox.address);
                return (
                  <div
                    className="item"
                    key={mailbox.address}
                    style={{ gridTemplateColumns: "1fr auto auto" }}
                  >
                    <span className="name">{mailbox.address}</span>
                    {conn ? (
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
                          {conn.displayName ? ` — ${conn.displayName}` : ""}
                        </span>
                        <a className="btn ghost" href="/api/onedrive/connect">
                          Reconnect
                        </a>
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
                        <a className="btn" href="/api/onedrive/connect">
                          Connect
                        </a>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
