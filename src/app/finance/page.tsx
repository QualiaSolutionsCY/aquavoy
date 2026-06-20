"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderTree,
  Sparkles,
  Send,
  Clock,
  TrendingUp,
  TrendingDown,
  Wallet,
  RefreshCw,
} from "lucide-react";

import type { PendingAction } from "@/lib/agents/pendingActions";
import type { FinanceSummary, FinanceCompanyTotals } from "@/lib/finance/ledger";

type Principal = "Wency" | "Jeanette";

/* The eight legal entities the group's accounting revolves around. Invoices,
   receipts, and accounting documents are filed per company. Source of truth for
   the finance section; mirror in .planning/CONTEXT.md. */
const COMPANIES = [
  "Aquavoy Holding",
  "Aquavoy Shipping",
  "Aquavoy Crewing",
  "W&D Holding",
  "W&D Trading",
  "Denver Services BV",
  "Faial BV",
  "Novo Porto Scheepvaart BV",
] as const;

/* Scope clause prepended to every finance instruction. With no company picked,
   the agent organizes all eight under their own top-level folders; with one
   picked, it works inside that company only. */
function companyClause(company: string | null): string {
  return company
    ? `Work only within the company "${company}". `
    : `The group has eight companies — organize each one's documents under its own top-level folder: ${COMPANIES.join(", ")}. `;
}

/* The one-click "Scan & propose" prompt. Phrased so the agent inspects the
   current OneDrive structure FIRST and stages moves for approval — it never
   reorganizes anything before showing the plan. */
function buildScanPrompt(company: string | null): string {
  return (
    "Help me organize my accounting files in OneDrive. " +
    companyClause(company) +
    "Find the invoices, receipts, and accounting-related documents, inspect the " +
    "current folder structure first, then propose a clean organization (by " +
    "company, then document type and year) and stage the moves for my approval. " +
    "Do not move anything without showing me the plan first."
  );
}

/* Tools whose confirmed effect can be reversed (ADR-003 §5). Mirrors the set
   in src/app/page.tsx — copied here intentionally (the chat page owns its own
   copy; this page must not import from a sibling route module). `send_email`
   is excluded — a sent message cannot be recalled. */
const REVERSIBLE_TOOLS = new Set([
  "move_item",
  "rename_item",
  "delete_item",
  "schedule_email",
  "record_finance_entry",
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

/* ── Finance overview (ADR-005 read side) ──
   The numbers come from the Supabase finance index via GET /api/finance/summary;
   the FILES stay in OneDrive. This section is the consolidated + per-company
   ledger view that the scan/propose flow below feeds into. */

/* Coerce a possibly-missing numeric field to a finite number — the summary is
   read defensively so a malformed total never NaNs the whole panel. */
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/* Format a money amount with the ledger's currency and grouped thousands.
   Falls back to a plain grouped number if the currency code is unusable, so an
   odd/blank currency from the index never throws in render. */
function formatMoney(amount: number, currency: string): string {
  const value = num(amount);
  const code = (currency || "EUR").trim().toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${code}`;
  }
}

/* Net is the headline signal per company and consolidated — tint positive
   (success) vs negative (danger) subtly; zero stays neutral so an all-zero
   ledger doesn't read as a wall of green/red. */
function netClass(net: number): string {
  if (net > 0) return "fin-net-pos";
  if (net < 0) return "fin-net-neg";
  return "fin-net-zero";
}

export default function Finance() {
  const [identity, setIdentity] = useState<Principal | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState("");
  const [hasRun, setHasRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Financial overview (ADR-005 read side) ──
  // Consolidated + per-company income/expense/net, loaded from the Supabase
  // finance index on mount. Independent of the scan/propose flow below.
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

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
   * Load the consolidated + per-company finance summary (ADR-005). Read on
   * mount and re-runnable from the error-state retry. The principal gate lives
   * on the route; a 401 here means the session lapsed — bounce to /login like
   * the identity check does.
   */
  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/finance/summary");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `Failed to load finance overview (${res.status})`);
      }
      setSummary((json.data ?? null) as FinanceSummary | null);
    } catch (e) {
      setSummaryError((e as Error).message);
    } finally {
      setSummaryLoading(false);
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
          loadSummary();
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
            onClick={() => send(buildScanPrompt(company))}
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

      <FinanceOverview
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        onRetry={loadSummary}
      />

      <p className="fin-intro">
        Ask Aquavoy to tidy up the accounting drive. It inspects the current
        folder layout, proposes a clean structure for your invoices, receipts,
        and accounting documents, and stages each move for your approval — nothing
        is reorganized until you confirm it below.
      </p>

      <div className="fin-companies" role="group" aria-label="Filter by company">
        <button
          type="button"
          className={`fin-company-chip${company === null ? " active" : ""}`}
          onClick={() => setCompany(null)}
          aria-pressed={company === null}
        >
          All companies
        </button>
        {COMPANIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`fin-company-chip${company === c ? " active" : ""}`}
            onClick={() => setCompany(c)}
            aria-pressed={company === c}
          >
            {c}
          </button>
        ))}
      </div>

      {error && (
        <div className="notice err" role="alert">
          {error}
        </div>
      )}

      <form
        className="fin-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(companyClause(company) + instruction);
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

/* ── Financial overview section (ADR-005 read side) ──
   Consolidated income/expense/net + a per-company breakdown, fed by the
   Supabase finance index. The eight group companies always render (the API
   includes zeroed entities), so the grid is the full group even before any
   invoice is logged — but when EVERYTHING is zero we show a friendly empty
   state instead of a wall of zeros. */
function FinanceOverview({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: FinanceSummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const currency = summary?.currency || "EUR";
  const companies: FinanceCompanyTotals[] = Array.isArray(summary?.companies)
    ? summary!.companies
    : [];

  const consolidated = {
    income: num(summary?.consolidated?.income),
    expense: num(summary?.consolidated?.expense),
    net: num(summary?.consolidated?.net),
    count: num(summary?.consolidated?.count),
  };

  // Empty when there is genuinely nothing logged across the whole group —
  // every consolidated total and the entry count are zero.
  const isEmpty =
    !loading &&
    !error &&
    summary !== null &&
    consolidated.count === 0 &&
    consolidated.income === 0 &&
    consolidated.expense === 0 &&
    consolidated.net === 0;

  return (
    <section className="fin-overview" aria-label="Financial overview">
      <div className="fin-overview-head">
        <span className="panel-h">Financial overview</span>
        {!loading && !error && summary && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={onRetry}
            aria-label="Refresh financial overview"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
        )}
      </div>

      {loading && (
        <div className="fin-overview-loading" role="status" aria-label="Loading financial overview">
          <div className="fin-consolidated">
            {[0, 1, 2].map((i) => (
              <div key={i} className="fin-stat">
                <span className="skeleton" style={{ width: "4.5rem", height: "0.75rem" }} />
                <span className="skeleton" style={{ width: "7rem", height: "1.5rem" }} />
              </div>
            ))}
          </div>
          <div className="fin-company-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="fin-company-card">
                <span className="skeleton" style={{ width: "60%", height: "0.875rem" }} />
                <span className="skeleton" style={{ width: "100%", height: "2.5rem" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="fin-overview-error">
          <div className="notice err" role="alert">
            {error}
          </div>
          <button type="button" className="btn" onClick={onRetry} aria-label="Retry loading financial overview">
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="fin-overview-empty empty">
          <Wallet className="empty-icon" size={30} strokeWidth={1.5} aria-hidden="true" />
          No finance entries yet — ask the agent to log invoices, e.g.
          &ldquo;log this invoice to Aquavoy Shipping&rdquo;.
          <span className="empty-hint">
            Logged invoices appear here as consolidated and per-company totals.
          </span>
        </div>
      )}

      {!loading && !error && summary && !isEmpty && (
        <>
          <div className="fin-consolidated" role="group" aria-label="Consolidated totals">
            <div className="fin-stat">
              <span className="fin-stat-label">
                <TrendingUp size={14} aria-hidden="true" />
                Total income
              </span>
              <span className="fin-stat-value fin-net-pos">
                {formatMoney(consolidated.income, currency)}
              </span>
            </div>
            <div className="fin-stat">
              <span className="fin-stat-label">
                <TrendingDown size={14} aria-hidden="true" />
                Total expense
              </span>
              <span className="fin-stat-value fin-net-neg">
                {formatMoney(consolidated.expense, currency)}
              </span>
            </div>
            <div className="fin-stat">
              <span className="fin-stat-label">
                <Wallet size={14} aria-hidden="true" />
                Net
              </span>
              <span className={`fin-stat-value ${netClass(consolidated.net)}`}>
                {formatMoney(consolidated.net, currency)}
              </span>
            </div>
          </div>

          <p className="fin-overview-meta">
            Across {companies.length} {companies.length === 1 ? "company" : "companies"} ·{" "}
            {consolidated.count} {consolidated.count === 1 ? "entry" : "entries"} ·{" "}
            {currency}
          </p>

          <div className="fin-company-grid" role="list" aria-label="Per-company breakdown">
            {companies.map((c, i) => {
              const income = num(c?.income);
              const expense = num(c?.expense);
              const net = num(c?.net);
              const count = num(c?.count);
              return (
                <div
                  className="fin-company-card"
                  role="listitem"
                  key={c?.company ?? i}
                >
                  <div className="fin-company-card-head">
                    <span className="fin-company-name">{c?.company ?? "—"}</span>
                    <span className="fin-company-count">
                      {count} {count === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <dl className="fin-company-rows">
                    <div className="fin-company-row">
                      <dt>Income</dt>
                      <dd className="fin-net-pos">{formatMoney(income, currency)}</dd>
                    </div>
                    <div className="fin-company-row">
                      <dt>Expense</dt>
                      <dd className="fin-net-neg">{formatMoney(expense, currency)}</dd>
                    </div>
                    <div className="fin-company-row fin-company-row-net">
                      <dt>Net</dt>
                      <dd className={netClass(net)}>{formatMoney(net, currency)}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
