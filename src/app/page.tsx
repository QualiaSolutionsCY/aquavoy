"use client";

import { useEffect, useRef, useState } from "react";

type Principal = "Wency" | "Jeanette";
const PRINCIPALS: Principal[] = ["Wency", "Jeanette"];

interface Msg {
  role: "user" | "assistant";
  content: string;
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
