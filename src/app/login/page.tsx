"use client";

import { useState } from "react";

type Principal = "Wency" | "Jeanette";
const PRINCIPALS: Principal[] = ["Wency", "Jeanette"];

/**
 * Credentialed login (ADR-001). Replaces the old auto-login splash: an operator
 * picks their identity, enters a password, and POSTs /api/login. On success the
 * server sets the signed session cookie and we hand off to the chat at "/".
 */
export default function Login() {
  const [principal, setPrincipal] = useState<Principal>("Wency");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal, password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const json = await res.json().catch(() => null);
      setError(json?.error ?? `Sign-in failed (${res.status})`);
      setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <img src="/logo.png" alt="Aquavoy Shipping Ltd" className="gate-logo" />
        <h1>Aquavoy</h1>
        <p className="tag">Sign in to continue</p>

        <div className="pick-row" role="group" aria-label="Choose operator">
          {PRINCIPALS.map((p) => {
            const active = p === principal;
            return (
              <button
                key={p}
                type="button"
                className="pick-btn"
                aria-pressed={active}
                onClick={() => setPrincipal(p)}
                style={
                  active
                    ? {
                        borderColor: "var(--accent)",
                        background: "var(--accent-subtle)",
                        boxShadow: "0 0 0 3px var(--accent-glow)",
                      }
                    : undefined
                }
              >
                {p}
              </button>
            );
          })}
        </div>

        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-2)",
            width: "100%",
            textAlign: "left",
            marginTop: "var(--sp-3)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.6875rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`Password for ${principal}`}
            autoComplete="current-password"
            autoFocus
            aria-label={`Password for ${principal}`}
          />
        </label>

        {error && (
          <p className="notice err" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="pick-btn"
          disabled={busy || !password}
          style={{
            width: "100%",
            background: "var(--accent)",
            color: "var(--bg)",
            borderColor: "var(--accent)",
            marginTop: "var(--sp-2)",
          }}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : "Sign in"}
        </button>

        <p className="gate-credit">
          Powered by{" "}
          <a href="https://qualiasolutions.net" target="_blank" rel="noopener noreferrer">
            Qualia Solutions
          </a>
        </p>
      </form>
    </main>
  );
}
