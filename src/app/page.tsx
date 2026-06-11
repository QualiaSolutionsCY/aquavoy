"use client";

import { useEffect, useRef, useState } from "react";

type Principal = "Wency" | "Jeanette";
const PRINCIPALS: Principal[] = ["Wency", "Jeanette"];

interface Msg {
  role: "user" | "assistant";
  content: string;
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

function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
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

export default function Chat() {
  const [identity, setIdentity] = useState<Principal | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Current thread id — "New chat" rotates it; old threads stay stored
  // and remain reachable through the agent's recall_memory tool.
  const sessionRef = useRef<string>(crypto.randomUUID());

  // ── History panel state ──
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
      const res = await fetch(
        `/api/chat/history?principal=${identity}&view=sessions`,
      );
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
      const res = await fetch(
        `/api/chat/history?principal=${identity}&sessionId=${sid}`,
      );
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
    setIdentity(name);
    setMessages([greeting(name)]);
    setError(null);

    // Hydrate the latest session (enhancement — failures are silent).
    try {
      const res = await fetch(`/api/chat/history?principal=${name}`);
      const json = await res.json();
      if (json.ok && json.data?.sessionId && json.data.messages.length > 0) {
        sessionRef.current = json.data.sessionId;
        setMessages(
          json.data.messages.map(
            (m: { role: "user" | "assistant"; content: string }) => ({
              role: m.role,
              content: m.content,
            }),
          ),
        );
      } else {
        sessionRef.current = crypto.randomUUID();
      }
    } catch {
      /* memory is an enhancement, not a blocker */
    }
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
    }).catch((e) => console.warn("chat-history persist failed", e));
  }

  /** Clear all stored messages for the current principal. */
  async function clearMemory() {
    if (!identity) return;
    if (!confirm(`Clear all saved messages for ${identity}?`)) return;
    try {
      await fetch(`/api/chat/history?principal=${identity}`, { method: "DELETE" });
    } catch (e) {
      console.warn("chat-history clear failed", e);
    }
    setMessages([greeting(identity)]);
  }

  async function send() {
    const text = input.trim();
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
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
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
    }
  }

  // ── Identity gate: choose Wency or Jeanette before chatting ──
  if (!identity) {
    return (
      <main className="gate">
        <div className="gate-card">
          <p className="gate-coords">51.92&deg; N &middot; 4.48&deg; E — Inland Waterways</p>
          <h1>Aquavoy</h1>
          <svg className="gate-wave" viewBox="0 0 140 12" aria-hidden="true">
            <path
              d="M0 6 Q 8.75 0, 17.5 6 T 35 6 T 52.5 6 T 70 6 T 87.5 6 T 105 6 T 122.5 6 T 140 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <p className="tag">Who is chatting today?</p>
          <div className="pick-row">
            {PRINCIPALS.map((name) => (
              <button key={name} className="pick-btn" onClick={() => pick(name)}>
                {name}
              </button>
            ))}
          </div>
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
            + New chat
          </button>
          <button
            className="btn ghost"
            onClick={toggleHistory}
            aria-label={historyOpen ? "Close chat history" : "Browse chat history"}
            aria-expanded={historyOpen}
          >
            History
          </button>
          <button
            className="btn ghost"
            onClick={clearMemory}
            aria-label="Clear conversation memory"
          >
            Clear memory
          </button>
          <button
            className="btn ghost"
            onClick={() => setIdentity(null)}
            aria-label="Switch user identity"
          >
            Switch
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
              &#x2715;
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

      <div className="thread" ref={scrollRef} role="log" aria-label="Chat messages">
        {messages.map((m, i) => (
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
          </div>
        ))}
      </div>

      <div className="composer">
        <textarea
          rows={1}
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
        <button
          className="btn"
          onClick={send}
          disabled={busy || !input.trim()}
          aria-label="Send message"
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : "Send"}
        </button>
      </div>
      <div className="chat-credit">
        Powered by{" "}
        <a href="https://qualiasolutions.net" target="_blank" rel="noopener noreferrer">
          Qualia Solutions
        </a>
      </div>
    </main>
  );
}
