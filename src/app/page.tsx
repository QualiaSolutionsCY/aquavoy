"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  FileText,
  Globe,
  History,
  Mail,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type { PendingAction } from "@/lib/agents/pendingActions";
import type { AgentTrace, Provider } from "@/lib/agents/traces";

type Principal = "Wency" | "Jeanette";

/* Bolt-style hero suggestion chips. Each fires a REAL Aquavoy capability —
   web search, OneDrive file lookup, crew email prep — so nothing on the
   landing surface is decorative. */
const SUGGESTIONS: { icon: typeof Globe; label: string; prompt: string }[] = [
  {
    icon: Globe,
    label: "Search the web",
    prompt: "Search the web for today's top inland-waterway shipping and logistics headlines.",
  },
  {
    icon: FileText,
    label: "Find a file",
    prompt: "Find my most recently modified files in OneDrive and list them.",
  },
  {
    icon: Mail,
    label: "Draft an email",
    prompt: "Help me draft a short email to a crew member about a schedule change.",
  },
  {
    icon: Sparkles,
    label: "What can you do?",
    prompt: "What can you help me with? List your capabilities briefly.",
  },
];

/* Tools whose confirmed effect can be reversed (ADR-003 §5). `send_email`
   is excluded — a sent message cannot be recalled. */
const REVERSIBLE_TOOLS = new Set([
  "move_item",
  "rename_item",
  "delete_item",
  "schedule_email",
]);
const PRINCIPALS: Principal[] = ["Wency", "Jeanette"];

interface Msg {
  role: "user" | "assistant";
  content: string;
  /* Per-turn observability (REQ-12/13). Populated after the stream completes
     when the SSE delivered a trailing `aquavoy_trace_id`. Absent on failure —
     the bubble renders exactly as before. */
  trace?: AgentTrace;
}

interface SessionSummary {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  count: number;
  title: string;
}

function greeting(name: Principal): Msg {
  return {
    role: "assistant",
    content: `Hi ${name}! I'm Aquavoy. I can answer questions, search the web for you, and help with your files. What do you need?`,
  };
}

/* ── Lightweight Markdown rendering for assistant replies ──
   Handles **bold**, *italic*, `code`, and "* " / "- " bullet markers.
   Newlines survive via the bubble's pre-wrap white-space. */
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

/* Defence against the model occasionally emitting raw HTML (e.g. a <table>
   describing a staged action) or a stray leading token. We never render HTML;
   this strips RECOGNISED HTML element tags down to readable text so the chat
   never shows raw <table> markup. Only known tags match, so prose like
   "x < 5 and y > 3" is left intact. */
const HTML_TAGS =
  /<\/?(?:table|thead|tbody|tfoot|tr|td|th|div|span|p|ul|ol|li|h[1-6]|a|img|pre|blockquote|b|i|u|strong|em)\b[^>]*>/gi;

function sanitizeModelText(text: string): string {
  if (!text.includes("<")) return text; // fast path — the common case
  return text
    .replace(/^[　-鿿]+(?=\s*<)/, "") // stray leading CJK artifact before a tag
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

/* Human-readable model label for the trace disclosure row (REQ-13).
   Gemini Flash collapses the long slug; OpenRouter shows the model's last
   path segment (e.g. "anthropic/claude-3.5" → "claude-3.5"). */
function friendlyModel(provider: Provider, model: string): string {
  if (provider === "gemini") {
    return model.toLowerCase().includes("flash") ? "Gemini Flash" : "Gemini";
  }
  const slug = model.split("/").pop() ?? model;
  return slug || "OpenRouter";
}

/** Soft-fail log for fire-and-forget enhancement paths — dev console only, never
 *  surfaced in the production browser console (LOW-1). */
function devWarn(message: string, err: unknown): void {
  if (process.env.NODE_ENV !== "production") console.warn(message, err);
}

export default function Chat() {
  const [identity, setIdentity] = useState<Principal | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Current thread id — "New chat" rotates it; old threads stay stored
  // and remain reachable through the agent's recall_memory tool.
  const sessionRef = useRef<string>(crypto.randomUUID());

  // ── History panel state ──
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  // ── Trace disclosure state ──
  // Which assistant bubbles have their per-tool trace panel expanded,
  // tracked by message index (mirrors the historyOpen disclosure pattern).
  const [traceOpen, setTraceOpen] = useState<Set<number>>(new Set());

  function toggleTrace(i: number) {
    setTraceOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // ── Pending destructive actions (ADR-003) ──
  // Staged confirm/cancel/undo cards rendered above the composer.
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Grow the composer with its content (bolt-style), capped at 40dvh.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [input]);

  // Close history panel on Escape key
  useEffect(() => {
    if (!historyOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setHistoryOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyOpen]);

  /** Fetch session list for the history panel. */
  async function loadHistory() {
    if (!identity) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/chat/history?view=sessions`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed to load history");
      setSessions(json.data?.sessions ?? []);
    } catch (e) {
      setHistoryError((e as Error).message);
      setSessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  /** Toggle history panel open/closed. */
  function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false);
    } else {
      setHistoryOpen(true);
      loadHistory();
    }
  }

  /** Open a specific session from history. */
  async function openSession(sid: string) {
    if (!identity || busy) return;
    setHistoryOpen(false);
    setError(null);
    try {
      const res = await fetch(`/api/chat/history?sessionId=${sid}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed to load session");
      const msgs: Msg[] = (json.data?.messages ?? []).map(
        (m: { role: "user" | "assistant"; content: string }) => ({
          role: m.role,
          content: m.content,
        }),
      );
      if (msgs.length > 0) {
        sessionRef.current = sid;
        setMessages(msgs);
      } else {
        setError("That session has no messages.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function pick(name: Principal) {
    const minDelay = new Promise((r) => setTimeout(r, 600));

    // Hydrate the latest session (enhancement — failures are silent).
    let msgs: Msg[] = [greeting(name)];
    let sid = crypto.randomUUID();
    try {
      const res = await fetch(`/api/chat/history`);
      const json = await res.json();
      if (json.ok && json.data?.sessionId && json.data.messages.length > 0) {
        sid = json.data.sessionId;
        msgs = json.data.messages.map(
          (m: { role: "user" | "assistant"; content: string }) => ({
            role: m.role,
            content: m.content,
          }),
        );
      }
    } catch {
      /* memory is an enhancement, not a blocker */
    }

    // Ensure splash shows for at least 600ms so the logo animation reads.
    await minDelay;

    sessionRef.current = sid;
    setMessages(msgs);
    setError(null);
    setIdentity(name);
  }

  /** Start a fresh thread — past sessions stay stored and recallable. */
  function newChat() {
    if (!identity || busy) return;
    sessionRef.current = crypto.randomUUID();
    setMessages([greeting(identity)]);
    setError(null);
  }

  /** Fire-and-forget: persist a single message to chat history. */
  function persist(principal: Principal, role: "user" | "assistant", content: string) {
    fetch("/api/chat/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ principal, role, content, sessionId: sessionRef.current }),
    }).catch((e) => devWarn("chat-history persist failed", e));
  }

  /** Clear all stored messages for the current principal. */
  async function clearMemory() {
    if (!identity) return;
    if (!window.confirm(`Clear all saved messages for ${identity}?`)) return;
    try {
      await fetch(`/api/chat/history`, { method: "DELETE" });
    } catch (e) {
      devWarn("chat-history clear failed", e);
    }
    setMessages([greeting(identity)]);
  }

  /** Refresh the list of staged destructive actions for this principal. */
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

      // Undo can be declined by the server (e.g. already sent) — surface why.
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
    // Show the confirmed/sent state briefly (Undo stays reachable for reversible
    // actions), then auto-dismiss the card so no green box lingers.
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

  async function send(forced?: string) {
    const text = (forced ?? input).trim();
    if (!text || busy || !identity) return;
    setError(null);
    setInput("");

    const history = [...messages, { role: "user", content: text } as Msg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    // Fire-and-forget: persist the user message.
    persist(identity, "user", text);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Drop the local greeting (index 0) before sending to the model.
          messages: history.slice(1),
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
      // Trailing trace id from the stream (REQ-12) — fetched after [DONE].
      let traceId: string | null = null;

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
            // The agent loop appends one trailing frame carrying the trace id.
            // It has no `choices[0].delta.content`, so it never reaches `acc`.
            if (typeof parsed?.aquavoy_trace_id === "string") {
              traceId = parsed.aquavoy_trace_id;
              continue;
            }
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              acc += delta;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: acc };
                return next;
              });
            }
          } catch {
            /* partial JSON — wait for the next chunk */
          }
        }
      }
      if (acc) {
        // Fire-and-forget: persist the assistant reply.
        persist(identity, "assistant", acc);
        // Observability enhancement: hydrate the trace, never block the reply.
        if (traceId) {
          try {
            const tr = await fetch(`/api/traces/${traceId}`);
            const tj = await tr.json();
            if (tj.ok && tj.data) {
              const trace = tj.data as AgentTrace;
              setMessages((prev) => {
                const next = [...prev];
                const last = next.length - 1;
                if (next[last]?.role === "assistant") {
                  next[last] = { ...next[last], trace };
                }
                return next;
              });
            }
          } catch {
            /* observability is an enhancement, not a blocker */
          }
        }
      } else {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: "(no response)" };
          return next;
        });
      }
    } catch (e) {
      setError((e as Error).message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setBusy(false);
      // The turn may have staged a destructive action — refresh the cards.
      loadPending();
    }
  }

  // ── Learn our identity from the verified session on mount (ADR-001) ──
  // No more self-electing "Wency": the principal comes from the signed
  // session cookie via GET /api/auth/me. On 401 we redirect to /login.
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
          pick(principal);
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

  // ── Splash screen while identity hydrates ──
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
          <p className="gate-credit">
            Powered by{" "}
            <a href="https://qualiasolutions.net" target="_blank" rel="noopener noreferrer">
              Qualia Solutions
            </a>
          </p>
        </div>
      </main>
    );
  }

  // Bolt-style hero shows only on a fresh thread (greeting alone, not mid-send).
  const isEmpty = messages.length <= 1 && !busy;

  // Single composer used in both surfaces: centered in the hero, docked in-thread.
  const composerCard = (
    <form
      className="composer-card"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={taRef}
        rows={1}
        className="composer-input"
        placeholder={`Message Aquavoy as ${identity}…`}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        aria-label="Type your message"
      />
      <div className="composer-foot">
        <span className="identity-chip" title={`Signed in as ${identity}`}>
          <span className="identity-dot" aria-hidden="true" />
          {identity}
        </span>
        <button
          type="submit"
          className="composer-send"
          disabled={busy || !input.trim()}
          aria-label="Send message"
        >
          {busy ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <ArrowUp size={18} strokeWidth={2.5} aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  );

  return (
    <main className="chat-wrap">
      <div className="chat-header">
        <div className="chat-header-info">
          <h1>Aquavoy</h1>
          <div className="chat-header-meta">
            Chatting as <strong>{identity}</strong> · AI assistant
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={newChat} aria-label="Start a new chat thread">
            <Plus size={16} aria-hidden="true" /> New chat
          </button>
          <button
            className="btn ghost"
            onClick={toggleHistory}
            aria-label={historyOpen ? "Close chat history" : "Browse chat history"}
            aria-expanded={historyOpen}
          >
            <History size={16} aria-hidden="true" /> History
          </button>
          <button
            className="btn ghost"
            onClick={clearMemory}
            aria-label="Clear conversation memory"
          >
            <Trash2 size={16} aria-hidden="true" /> Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}

      {historyOpen && (
        <div
          className="history-panel"
          ref={historyPanelRef}
          role="dialog"
          aria-label="Chat history"
        >
          <div className="history-header">
            <span className="panel-h">Past conversations</span>
            <button
              className="btn ghost history-close"
              onClick={() => setHistoryOpen(false)}
              aria-label="Close history panel"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {historyLoading && (
            <div className="history-list">
              {[1, 2, 3].map((n) => (
                <div key={n} className="skeleton-row">
                  <div className="skeleton" style={{ width: "1.25rem", height: "1.25rem" }} />
                  <div className="skeleton" />
                  <div className="skeleton meta" />
                </div>
              ))}
            </div>
          )}

          {historyError && (
            <div className="notice err" role="alert">
              {historyError}
            </div>
          )}

          {!historyLoading && !historyError && sessions.length === 0 && (
            <div className="empty">No past conversations yet.</div>
          )}

          {!historyLoading && !historyError && sessions.length > 0 && (
            <div className="history-list">
              {sessions.map((s) => (
                <button
                  key={s.sessionId}
                  className={`history-item${s.sessionId === sessionRef.current ? " active" : ""}`}
                  onClick={() => openSession(s.sessionId)}
                  aria-label={`Open conversation: ${s.title}`}
                  aria-current={
                    s.sessionId === sessionRef.current ? "true" : undefined
                  }
                >
                  <span className="history-title">{s.title}</span>
                  <span className="history-meta">
                    <span className="history-count">
                      {s.count} msg{s.count !== 1 ? "s" : ""}
                    </span>
                    <span className="history-date">
                      {new Date(s.lastAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isEmpty ? (
        <div className="chat-hero">
          <div className="hero-rays" aria-hidden="true" />
          <div className="hero-inner">
            <h2 className="hero-title">What can I help with, {identity}?</h2>
            <p className="hero-sub">
              Ask anything — I can search the web, work with your OneDrive files, and
              prep crew email.
            </p>
            {composerCard}
            <div className="suggest-row">
              {SUGGESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.label}
                    type="button"
                    className="suggest-chip"
                    onClick={() => send(s.prompt)}
                    disabled={busy}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
      <div className="thread" ref={scrollRef} role="log" aria-label="Chat messages">
        {messages.map((m, i) => {
          const trace = m.trace;
          const open = traceOpen.has(i);
          const panelId = `trace-panel-${i}`;
          const toolCount = trace?.toolCalls.length ?? 0;
          return (
            <div key={i} className={`bubble ${m.role}`}>
              <span className="who">{m.role === "user" ? identity : "Aquavoy"}</span>
              <div className="text">
                {m.content ? (
                  m.role === "assistant" ? (
                    renderMarkdown(m.content)
                  ) : (
                    m.content
                  )
                ) : busy && i === messages.length - 1 ? (
                  <span className="typing-dots" role="status" aria-label="Aquavoy is thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  ""
                )}
              </div>
              {trace && (
                <>
                  <button
                    type="button"
                    className="trace-row"
                    onClick={() => toggleTrace(i)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-label={`${open ? "Hide" : "Show"} agent trace: ${toolCount} tool${
                      toolCount !== 1 ? "s" : ""
                    }, ${friendlyModel(trace.provider, trace.model)}, ${(
                      trace.latencyMs / 1000
                    ).toFixed(1)} seconds`}
                  >
                    <span className="trace-caret" aria-hidden="true">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="trace-summary">
                      {toolCount} tool{toolCount !== 1 ? "s" : ""}
                      {" · "}
                      {friendlyModel(trace.provider, trace.model)}
                      {" · "}
                      {(trace.latencyMs / 1000).toFixed(1)} s
                    </span>
                  </button>
                  {open && (
                    <div className="trace-panel" role="region" id={panelId} aria-label="Agent trace detail">
                      {toolCount === 0 ? (
                        <p className="trace-empty">No tools were called this turn.</p>
                      ) : (
                        <ul className="trace-tools">
                          {trace.toolCalls.map((tc, ti) => (
                            <li
                              key={ti}
                              className={`trace-tool${tc.error ? " error" : ""}`}
                            >
                              <div className="trace-tool-head">
                                <span className="trace-tool-name">{tc.name}</span>
                                <span className="trace-tool-latency">
                                  {(tc.latencyMs / 1000).toFixed(2)} s
                                </span>
                              </div>
                              <div className="trace-tool-args">{tc.argsSummary}</div>
                              {tc.error ? (
                                <div className="trace-tool-error" role="alert">
                                  {tc.error}
                                </div>
                              ) : (
                                <div className="trace-tool-result">{tc.resultSummary}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="trace-tokens">
                        {trace.promptTokens + trace.completionTokens} tokens
                        {" · "}
                        {trace.promptTokens} in / {trace.completionTokens} out
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      )}

      {pending.length > 0 && (
        <div className="action-stack" role="region" aria-label="Pending actions">
          {actionError && (
            <div className="notice err" role="alert">
              {actionError}
            </div>
          )}
          {pending.map((a) => {
            const busy = actionBusy === a.id;
            const confirmed = a.status === "confirmed";
            const reversible = REVERSIBLE_TOOLS.has(a.tool);
            return (
              <div
                key={a.id}
                className={`action-card${confirmed ? " confirmed" : ""}`}
                role="group"
                aria-label={`Pending action: ${a.summary}`}
              >
                <div className="action-head">
                  <span className="action-tag">
                    {confirmed ? "Confirmed" : "Confirm needed"}
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
                        disabled={busy}
                        aria-label={`Confirm: ${a.summary}`}
                      >
                        {busy ? <span className="spinner" aria-hidden="true" /> : "Confirm"}
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => cancelAction(a.id)}
                        disabled={busy}
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
                      disabled={busy}
                      aria-label={`Undo: ${a.summary}`}
                    >
                      {busy ? <span className="spinner" aria-hidden="true" /> : "Undo"}
                    </button>
                  )}
                  {confirmed && !reversible && (
                    <span className="action-note" role="status">
                      sent — cannot undo
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isEmpty && <div className="composer-dock">{composerCard}</div>}
      <div className="chat-credit">
        Powered by{" "}
        <a href="https://qualiasolutions.net" target="_blank" rel="noopener noreferrer">
          Qualia Solutions
        </a>
      </div>
    </main>
  );
}
