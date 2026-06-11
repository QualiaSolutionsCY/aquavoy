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

export default function Chat() {
  const [identity, setIdentity] = useState<Principal | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [web, setWeb] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function pick(name: Principal) {
    setIdentity(name);
    setMessages([greeting(name)]);
    setError(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !identity) return;
    setError(null);
    setInput("");

    const history = [...messages, { role: "user", content: text } as Msg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Drop the local greeting (index 0) before sending to the model.
          messages: history.slice(1),
          identity,
          web,
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
      if (!acc) {
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
          <h1>Aquavoy</h1>
          <p className="tag">Who is chatting today?</p>
          <div className="pick-row">
            {PRINCIPALS.map((name) => (
              <button key={name} className="pick-btn" onClick={() => pick(name)}>
                {name}
              </button>
            ))}
          </div>
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
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      <div className="composer">
        <button
          className={`web-toggle ${web ? "on" : ""}`}
          onClick={() => setWeb((w) => !w)}
          title="Toggle internet search"
          aria-pressed={web}
          aria-label={`Web search ${web ? "enabled" : "disabled"}`}
        >
          Web {web ? "on" : "off"}
        </button>
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
          {busy ? "…" : "Send"}
        </button>
      </div>
    </main>
  );
}
