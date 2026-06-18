"use client";

import { useEffect, useRef, useState } from "react";
import { FolderTree, Sparkles, Send, Clock } from "lucide-react";

import type { PendingAction } from "@/lib/agents/pendingActions";

type Principal = "Wency" | "Jeanette";

/* The one-click "Scan & propose" prompt. Phrased so the agent inspects the
   current OneDrive structure FIRST and stages moves for approval — it never
   reorganizes anything before showing the plan. */
const SCAN_PROMPT =
  "Help me organize my accounting files in OneDrive. Find the invoices, " +
  "receipts, and accounting-related documents, inspect the current folder " +
  "structure first, then propose a clean organization (e.g. by document type " +
  "and year) and stage the moves for my approval. Do not move anything " +
  "without showing me the plan first.";

/* Tools whose confirmed effect can be reversed (ADR-003 §5). Mirrors the set
   in src/app/page.tsx — copied here intentionally (the chat page owns its own
   copy; this page must not import from a sibling route module). `send_email`
   is excluded — a sent message cannot be recalled. */
const REVERSIBLE_TOOLS = new Set([
  "move_item",
  "rename_item",
  "delete_item",
  "schedule_email",
]);

/* ── Lightweight Markdown rendering for the agent's proposal ──
   Handles **bold**, *italic*, `code`, and "* " / "- " bullet markers.
   Mirrors src/app/page.tsx so the finance proposal reads like a chat reply. */
const INLINE_MD = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE_MD).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/* Defence against the model emitting raw HTML — we never render HTML, so
   recognised element tags are stripped down to readable text. Only known tags
   match, so prose like "x < 5 and y > 3" is left intact. */
const HTML_TAGS =
  /<\/?(?:table|thead|tbody|tfoot|tr|td|th|div|span|p|ul|ol|li|h[1-6]|a|img|pre|blockquote|b|i|u|strong|em)\b[^>]*>/gi;

function sanitizeModelText(text: string): string {
  if (!text.includes("<")) return text;
  return text
    .replace(/^[　-鿿]+(?=\s*<)/, "")
    .replace(/<\/(?:tr|p|div|li|h[1-6]|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)\s*>/gi, " — ")
    .replace(HTML_TAGS, "")
    .replace(/ — *(\n|$)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderMarkdown(text: string): React.ReactNode {
  return sanitizeModelText(text).split("\n").map((line, i) => {
    const bullet = line.match(/^(\s*)[*-]\s+(.*)$/);
    return (
      <span key={i}>
        {i > 0 && "\n"}
        {bullet ? (
          <>
            {bullet[1]}&bull; {renderInline(bullet[2])}
          </>
        ) : (
          renderInline(line)
        )}
      </span>
    );
  });
}

/** Soft-fail log for fire-and-forget paths — dev console only. */
function devWarn(message: string, err: unknown): void {
  if (process.env.NODE_ENV !== "production") console.warn(message, err);
}

export default function Finance() {
  const [identity, setIdentity] = useState<Principal | null>(null);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Staged destructive actions (ADR-003) ──
  // The agent's proposed moves/renames/folder-creations arrive auto-staged and
  // are rendered as confirm/cancel/undo cards. Approving a move performs it.
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const proposalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    proposalRef.current?.scrollTo({
      top: proposalRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [proposal]);

  /** Refresh the list of staged actions for this principal. */
  async function loadPending() {
    try {
      const res = await fetch("/api/actions");
      const json = await res.json();
      setPending(json.data?.actions ?? []);
    } catch (e) {
      devWarn("pending-actions load failed", e);
    }
  }

  /**
   * POST to an action lifecycle route. `confirm` keeps the card visible in its
   * new (`confirmed`) state so the Undo affordance can render; `cancel` and a
   * successful `undo` drop the card. The returned action is merged into local
   * state by id so the transition is immediate, then `loadPending` reconciles.
   * Mirrors the lifecycle logic in src/app/page.tsx.
   */
  async function runAction(id: string, route: string, drop: boolean): Promise<boolean> {
    setActionError(null);
    setActionBusy(id);
    try {
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `Action failed (${res.status})`);
      }

      const undoDeclined = route.endsWith("/undo") && json.data?.undone === false;
      if (undoDeclined && json.data?.reason) {
        setActionError(json.data.reason);
      }

      const updated = json.data?.action as PendingAction | undefined;
      setPending((prev) => {
        if (drop && !undoDeclined) return prev.filter((a) => a.id !== id);
        if (updated) return prev.map((a) => (a.id === id ? updated : a));
        return prev;
      });
      return !undoDeclined;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    } finally {
      setActionBusy(null);
    }
  }

  function confirm(id: string) {
    runAction(id, "/api/actions/confirm", false).then((ok) => {
      if (ok) {
        setTimeout(
          () => setPending((prev) => prev.filter((a) => a.id !== id)),
          4500,
        );
      }
    });
  }
  function cancelAction(id: string) {
    return runAction(id, "/api/actions/cancel", true);
  }
  function undo(id: string) {
    return runAction(id, "/api/actions/undo", true);
  }

  /**
   * Send a finance instruction to the EXISTING /api/chat endpoint and stream
   * the agent's proposal. Parses OpenRouter's SSE the same way src/app/page.tsx
   * does: `data:` lines, `[DONE]`, ignoring the trailing aquavoy_trace_id frame.
   */
  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy || !identity) return;
    setError(null);
    setProposal("");
    setHasRun(true);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          identity,
        }),
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      // Parse OpenRouter's SSE: lines of `data: {json}` ending with `data: [DONE]`.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            // The agent loop appends one trailing frame carrying the trace id;
            // it has no content delta, so it never reaches `acc`.
            if (typeof parsed?.aquavoy_trace_id === "string") continue;
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              acc += delta;
              setProposal(acc);
            }
          } catch {
            /* partial JSON — wait for the next chunk */
          }
        }
      }
      if (!acc) setProposal("(no response)");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      // The turn may have staged moves/renames — refresh the cards.
      loadPending();
    }
  }

  // ── Learn identity from the verified session on mount (ADR-001) ──
  // Mirrors src/app/page.tsx: principal comes from the signed session cookie
  // via GET /api/auth/me. On 401 we redirect to /login.
  useEffect(() => {
    if (identity) return;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        const principal = json?.data?.principal as Principal | undefined;
        if (json.ok && principal) {
          setIdentity(principal);
          loadPending();
        } else {
          window.location.href = "/login";
        }
      } catch {
        window.location.href = "/login";
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Splash while identity hydrates (mirrors the chat gate) ──
  if (!identity) {
    return (
      <main className="gate">
        <div className="gate-card">
          <img src="/logo.png" alt="Aquavoy Shipping Ltd" className="gate-logo" />
          <h1>Aquavoy</h1>
          <span className="typing-dots gate-loader" role="status" aria-label="Loading">
            <span />
            <span />
            <span />
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <h1>Finance</h1>
          <div className="tag">Invoice &amp; receipt organization · OneDrive</div>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={() => send(SCAN_PROMPT)}
            disabled={busy}
            aria-label="Scan OneDrive and propose an organization for accounting files"
          >
            {busy ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Sparkles size={16} aria-hidden="true" />
            )}
            Scan &amp; propose organization
          </button>
        </div>
      </div>

      <p className="fin-intro">
        Ask Aquavoy to tidy up the accounting drive. It inspects the current
        folder layout, proposes a clean structure for your invoices, receipts,
        and accounting documents, and stages each move for your approval — nothing
        is reorganized until you confirm it below.
      </p>

      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}

      <form
        className="fin-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(instruction);
          setInstruction("");
        }}
      >
        <label className="fin-label" htmlFor="fin-instruction">
          Custom instruction
        </label>
        <div className="fin-composer-row">
          <input
            id="fin-instruction"
            className="fin-input"
            placeholder="e.g. Organize the 2026 receipts into monthly subfolders"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            aria-label="Custom finance organization instruction"
          />
          <button
            type="submit"
            className="btn"
            disabled={busy || !instruction.trim()}
            aria-label="Send instruction to Aquavoy"
          >
            {busy ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
            Send
          </button>
        </div>
      </form>

      <section className="fin-proposal" aria-label="Agent proposal">
        <span className="panel-h">Proposed organization</span>
        <div className="fin-proposal-body" ref={proposalRef} role="log" aria-live="polite">
          {proposal ? (
            <div className="fin-proposal-text">{renderMarkdown(proposal)}</div>
          ) : busy ? (
            <span className="typing-dots" role="status" aria-label="Aquavoy is thinking">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <div className="empty">
              <FolderTree className="empty-icon" size={30} strokeWidth={1.5} aria-hidden="true" />
              {hasRun ? "The agent returned no proposal." : "No proposal yet."}
              <span className="empty-hint">
                Click <strong>Scan &amp; propose</strong> or send a custom instruction
                to get a plan.
              </span>
            </div>
          )}
        </div>
      </section>

      {pending.length > 0 && (
        <div className="action-stack" role="region" aria-label="Proposed actions">
          {actionError && (
            <div className="notice err" role="alert">
              {actionError}
            </div>
          )}
          {pending.map((a) => {
            const cardBusy = actionBusy === a.id;
            const confirmed = a.status === "confirmed";
            const reversible = REVERSIBLE_TOOLS.has(a.tool);
            return (
              <div
                key={a.id}
                className={`action-card${confirmed ? " confirmed" : ""}`}
                role="group"
                aria-label={`Proposed action: ${a.summary}`}
              >
                <div className="action-head">
                  <span className="action-tag">
                    {confirmed ? "Confirmed" : "Approve to apply"}
                  </span>
                  <span className="action-tool">{a.tool}</span>
                </div>
                <p className="action-summary">{a.summary}</p>
                <span className="action-id">id {a.id}</span>
                <div className="action-actions">
                  {!confirmed && (
                    <>
                      <button
                        className="btn"
                        onClick={() => confirm(a.id)}
                        disabled={cardBusy}
                        aria-label={`Approve: ${a.summary}`}
                      >
                        {cardBusy ? <span className="spinner" aria-hidden="true" /> : "Approve"}
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => cancelAction(a.id)}
                        disabled={cardBusy}
                        aria-label={`Cancel: ${a.summary}`}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {confirmed && reversible && (
                    <button
                      className="btn danger"
                      onClick={() => undo(a.id)}
                      disabled={cardBusy}
                      aria-label={`Undo: ${a.summary}`}
                    >
                      {cardBusy ? <span className="spinner" aria-hidden="true" /> : "Undo"}
                    </button>
                  )}
                  {confirmed && !reversible && (
                    <span className="action-note" role="status">
                      applied — cannot undo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* AUTOMATIC organization is DEFERRED to a later phase (OWNER-approved
          MVP is manual + agent-assisted only). This is a clearly-disabled
          affordance — never wired, never faked. */}
      <div className="fin-soon" aria-hidden="false">
        <div className="fin-soon-head">
          <Clock size={15} strokeWidth={1.75} aria-hidden="true" />
          <span>Automatic organization</span>
          <span className="fin-soon-badge">Coming soon</span>
        </div>
        <p className="fin-soon-body">
          Scheduled, hands-off filing of new invoices and receipts as they land
          in OneDrive. Not available yet — for now, run a scan or send an
          instruction above and approve the proposed moves.
        </p>
      </div>
    </main>
  );
}
