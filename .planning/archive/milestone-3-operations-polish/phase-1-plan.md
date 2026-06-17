---
phase: 1
goal: "Every agent turn writes a structured trace record to the database (model, provider, tool calls with names/args/result shape, latency per call, token counts); the chat UI surfaces a collapsible 'what ran' panel per response."
tasks: 3
waves: 3
---

# Phase 1: Observability

**Goal:** Every agent turn writes a structured trace record to the database (model chosen, provider that answered, all tool calls with names/args/result shape, latency per call, total token counts), and the chat UI surfaces a collapsible "what ran" panel for each response.
**Why this phase:** Operators currently fly blind — they cannot see which model answered, which tools ran, or how long a turn took without tailing server logs. Phase 2 (Mail Stack Decision) also depends on traces to confirm which mail path actually fires in production before one is removed (ROADMAP.md:64).

---

## Task 1 — `agent_traces` migration + trace persistence library
**Wave:** 1
**Persona:** backend
**Files:**
- CREATE `supabase/migrations/0011_agent_traces.sql` — the `public.agent_traces` table (RLS-on, no policies; service-role only).
- CREATE `src/lib/agents/traces.ts` — exports `type ToolCallTrace`, `type AgentTrace`, `type AgentTraceInput`, `insertTrace(input: AgentTraceInput): Promise<string>` (returns the new row id), and `getTrace(id: string): Promise<AgentTrace | null>`.
**Depends on:** none

**Why:** REQ-14 requires per-turn metrics to be stored in the database and queryable. The persistence seam must exist before the agent loop can write to it (Task 2) or the API can read it (Task 2). The table must follow the project's locked DB pattern — service-role only, RLS on with no policies (PROJECT.md:58 "Supabase service-role only, RLS-on/no-policy"; mirrors `supabase/migrations/0010_pending_actions.sql:36-37`).

**Acceptance Criteria:**
- A migration file `0011_agent_traces.sql` exists creating `public.agent_traces` with columns: `id uuid pk default gen_random_uuid()`, `principal text not null check (principal in ('Wency','Jeanette'))`, `model text not null`, `provider text not null check (provider in ('openrouter','gemini'))`, `tool_calls jsonb not null default '[]'::jsonb`, `latency_ms integer not null`, `prompt_tokens integer not null default 0`, `completion_tokens integer not null default 0`, `error text`, `created_at timestamptz not null default now()`.
- The migration enables RLS (`alter table public.agent_traces enable row level security;`) and declares NO policies — matching `0010_pending_actions.sql:36-37`.
- The migration adds an index on `(principal, created_at)` for recency-ordered reads.
- `src/lib/agents/traces.ts` exports `insertTrace` which inserts one row via `supabaseAdmin()` and returns the generated `id`; and `getTrace(id)` which selects one row by id and maps snake_case DB columns to a camelCase `AgentTrace` (mirroring the `toPendingAction` mapper in `src/lib/agents/pendingActions.ts:54`).
- `ToolCallTrace` is `{ name: string; argsSummary: string; resultSummary: string; latencyMs: number; error: string | null }`.

**Action:**
- Write the migration following the exact comment + structure style of `supabase/migrations/0010_pending_actions.sql` (header comment explaining service-role lockdown, the `create table if not exists`, a `comment on table`, the index, then `enable row level security`). The `provider` check matches the two real providers resolved in `src/lib/openrouter/client.ts:215-232` (`gemini` when `GOOGLE_API_KEY` set, else `openrouter`).
- In `traces.ts`, import `supabaseAdmin` from `@/lib/supabase/server` (the only DB seam — `src/lib/supabase/server.ts:12`). Define `const TABLE = "agent_traces";`. `insertTrace` does `.from(TABLE).insert({...}).select("id").single()` and returns `data.id`. On Supabase error, throw `new Error(error.message)` (caller in Task 2 wraps writes so a trace failure never breaks the turn).
- `AgentTraceInput` = `{ principal: string; model: string; provider: "openrouter" | "gemini"; toolCalls: ToolCallTrace[]; latencyMs: number; promptTokens: number; completionTokens: number; error: string | null }`. Serialize `toolCalls` into the `tool_calls` JSONB column.
- `getTrace` maps row → `AgentTrace` (camelCase) including `toolCalls`, `latencyMs`, `promptTokens`, `completionTokens`, `error`, `createdAt`.
- Apply the migration locally: `npx supabase migration up` (or `npx supabase db push` per the project's flow) — do NOT hand-apply to remote (constitution).

**Validation:** (builder self-check)
- `test -f supabase/migrations/0011_agent_traces.sql && echo EXISTS` → `EXISTS`
- `grep -c "enable row level security" supabase/migrations/0011_agent_traces.sql` → `1`
- `grep -cE "create policy" supabase/migrations/0011_agent_traces.sql` → `0` (no policies — service-role lockdown)
- `grep -c "export async function insertTrace" src/lib/agents/traces.ts` → `1`
- `grep -c "export async function getTrace" src/lib/agents/traces.ts` → `1`
- `npx tsc --noEmit 2>&1 | grep -c "traces.ts"` → `0`

**Context:** Read @supabase/migrations/0010_pending_actions.sql, @src/lib/agents/pendingActions.ts, @src/lib/supabase/server.ts, @src/lib/openrouter/client.ts, @.planning/PROJECT.md

---

## Task 2 — Instrument the agent loop + persist trace + expose it over SSE and a fetch route
**Wave:** 2
**Persona:** backend
**Files:**
- MODIFY `src/lib/openrouter/client.ts` — change `streamChatWithTools` to capture model/provider/per-tool latency/token usage, persist a trace, and append a trailing trace-id SSE line to the final stream. Add a `principal` to `ChatOptions` (or accept it as a param) so the trace row is owned by the verified session identity.
- MODIFY `src/app/api/chat/route.ts` — pass the verified `identity` through so the trace is written with the correct principal; ensure the trace is written even when the loop throws.
- CREATE `src/app/api/traces/[id]/route.ts` — `GET` returns the stored trace as `{ ok: true, data: AgentTrace }` for the disclosure panel; 404 → `{ ok: false }`.
**Depends on:** Task 1

**Why:** REQ-12/REQ-13/REQ-14 and success criteria 2 & 3 require model, provider, every tool call (name/argsSummary/resultSummary/latency/error), latency_ms, and token counts captured per turn and never silently omitted — even when the loop errors mid-turn. The capture must hook the REAL loop at `src/lib/openrouter/client.ts:286-352` (where tools are dispatched at line 343) and the REAL final streaming call (lines 356-373), not an invented path. All writes are server-side inside the existing SSE route — zero new client-bundle dependencies (success criterion 4).

**Acceptance Criteria:**
- For every completed turn, exactly one `agent_traces` row is written with `model`, `provider`, `tool_calls` (a JSONB array — one entry per tool the model called, each with `name`, `argsSummary`, `resultSummary`, `latencyMs`, `error`), `latency_ms` (wall-clock for the whole turn), `prompt_tokens`, and `completion_tokens` — all non-null.
- A slow or failed tool call appears in `tool_calls` with its measured `latencyMs` and, on failure, a non-null `error` string (the `executeTool` result is parsed: when it is `{"error": "..."}` the `error` field is populated and `resultSummary` reflects the failure).
- If the agent loop throws mid-turn (e.g. an upstream 502 from `client.ts:303`), a trace row is STILL written with `error` set to the thrown message and whatever tool calls completed before the throw — the record is never silently omitted (success criterion 3).
- The final SSE stream forwarded to the browser is byte-for-byte the same OpenRouter deltas as today, PLUS one trailing line `data: {"aquavoy_trace_id":"<uuid>"}` emitted just before `data: [DONE]`. The existing client parser (`src/app/page.tsx:336`) reads only `choices[0].delta.content`, so this extra line yields `undefined` and is safely ignored by the current client.
- `GET /api/traces/<uuid>` returns `{ ok: true, data: { model, provider, toolCalls, latencyMs, promptTokens, completionTokens, error, createdAt } }`; an unknown id returns 404 with `{ ok: false }`. The route derives nothing from the body and requires a verified principal (`getPrincipal(req)`, `src/lib/auth/session.ts:60`) — return 401 if absent, matching `src/app/api/chat/route.ts:19-21`.

**Action:**
- In `streamChatWithTools`: resolve `const provider = chatProvider();` (already at line 274) and capture `const providerName = provider.openrouter ? "openrouter" : "gemini";` and `provider.model`. Start `const turnStart = Date.now();`.
- Build `const toolTraces: ToolCallTrace[] = [];` and `let promptTokens = 0, completionTokens = 0;`.
- After each non-streaming response `json` is parsed (line 306), read `json.usage` (OpenAI wire: `{ prompt_tokens, completion_tokens, total_tokens }`) and accumulate `promptTokens += json.usage?.prompt_tokens ?? 0; completionTokens += json.usage?.completion_tokens ?? 0;`. Add a `usage?` field to the existing response type at `client.ts:306`.
- Wrap the `executeTool` call at line 343: `const tStart = Date.now(); const result = await executeTool(...); const latencyMs = Date.now() - tStart;`. Parse `result` (it is always JSON per `onedriveTools.ts:597-814`): derive `error` = `parsed.error ?? null`, `argsSummary` = a compact one-line stringify of `args` capped at ~200 chars, `resultSummary` = first ~200 chars of `result`. Push `{ name: tc.function.name, argsSummary, resultSummary, latencyMs, error }` to `toolTraces`.
- On the FINAL streaming call (line 356), add `stream_options: { include_usage: true }` to `finalPayload` so the terminal SSE chunk carries `usage` (OpenRouter/OpenAI emit a final delta with `usage` when this is set). Wrap `finalRes.body` in a `ReadableStream` (or `TransformStream`) that: (a) passes every upstream chunk through unchanged; (b) parses each `data:` line to capture `usage` if present, adding to `completionTokens`; (c) just before forwarding the upstream `data: [DONE]`, persists the trace via `insertTrace(...)`, then enqueues `data: {"aquavoy_trace_id":"<id>"}\n\n` followed by the original `data: [DONE]`. Keep the existing line-buffering discipline (split on `\n`, keep the trailing partial) so multibyte chunks are not corrupted.
- Compute `latency_ms = Date.now() - turnStart` at trace-write time.
- Error path: wrap the whole tool-loop + final-call body in `try/catch`. On throw, call `insertTrace({ ..., error: err.message, toolCalls: toolTraces, completionTokens, promptTokens, latencyMs: Date.now()-turnStart })` and re-throw so `route.ts:59-62` still returns its 502. This guarantees criterion 3.
- Thread the principal: add `principal?: string` to `ChatOptions` (`client.ts:46`). In `route.ts:51`, pass `{ identity, principal: identity }` (the verified principal from `getPrincipal`, route.ts:19). Use it as the trace `principal`.
- New route `src/app/api/traces/[id]/route.ts`: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`. `GET(req, { params })` → check `getPrincipal(req)` (401 if null), `const { id } = await params;`, `const trace = await getTrace(id);`, return 404 `{ ok:false }` if null else `{ ok:true, data: trace }`. Use `NextResponse.json` exactly as `src/app/api/chat/route.ts` does.

**Validation:** (builder self-check)
- `grep -c "stream_options" src/lib/openrouter/client.ts` → `1`
- `grep -c "insertTrace" src/lib/openrouter/client.ts` → ≥ `2` (success path + catch path)
- `grep -c "aquavoy_trace_id" src/lib/openrouter/client.ts` → ≥ `1`
- `grep -c "import .*getTrace" src/app/api/traces/[id]/route.ts` → `1`
- `grep -c "getPrincipal" src/app/api/traces/[id]/route.ts` → `1`
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/lib/openrouter/client.ts, @src/app/api/chat/route.ts, @src/lib/agents/traces.ts, @src/lib/agents/onedriveTools.ts, @src/lib/auth/session.ts

---

## Task 3 — Chat disclosure row + expandable per-tool trace panel
**Wave:** 3
**Persona:** frontend
**Files:**
- MODIFY `src/app/page.tsx` — capture the trailing `aquavoy_trace_id` from the SSE stream during `send()`, fetch `GET /api/traces/<id>`, store the trace alongside the assistant message, and render a collapsible disclosure row under that bubble.
- MODIFY `src/app/globals.css` — add the disclosure-row / trace-panel styles using the existing OKLCH token system (no new aesthetic).
**Depends on:** Task 2

**Why:** REQ-12 and REQ-13 and success criterion 1 require that after any agent response the chat shows a disclosure row (e.g. "3 tools · Gemini Flash · 1.2 s") expandable to a per-tool trace with name, argument summary, and latency — no network tab required. This is the operator-facing payoff of the whole phase.

**Acceptance Criteria:**
- After an assistant reply finishes, a disclosure row renders under that bubble showing tool count, a friendly provider/model label, and total latency in seconds — e.g. `3 tools · Gemini Flash · 1.2 s` (0 tools renders `0 tools · …`).
- Clicking the row (a real `<button>` with `aria-expanded`) toggles a panel listing each tool call: tool `name`, the `argsSummary`, the `resultSummary`, and per-tool latency. A tool call with a non-null `error` renders with the `--danger` token and shows the error text.
- The disclosure row is keyboard-operable (Enter/Space) and screen-reader labeled; the expanded panel uses `aria-controls`/region semantics consistent with the existing history panel (`src/app/page.tsx:457-526`).
- Metadata (tool names, latency, token counts) renders in JetBrains Mono (`--font-mono`) per DESIGN.md §3; all surfaces use the surface-step tokens (`--surface`/`--surface-2`), no hardcoded hex, no `#000`/`#fff`.
- If the trace fetch fails or no trace id arrives, the assistant bubble renders exactly as today (the row is simply absent) — observability is an enhancement, never a blocker (matches the fire-and-forget pattern at `src/app/page.tsx:208-215`).
- Works at 375 px (no horizontal overflow) and 1440 px; interactive targets ≥ 44 px (DESIGN.md §10).

**Action:**
- Extend the `Msg` interface (`src/app/page.tsx:19-22`) with an optional `trace?: AgentTrace` (import the type from `@/lib/agents/traces`). Keep the assistant placeholder bubble logic intact.
- In `send()` SSE parsing (`src/app/page.tsx:330-348`): when a parsed `data:` JSON has an `aquavoy_trace_id` string, stash it in a local `let traceId: string | null`. Do NOT treat it as content (it has no `choices[0].delta.content`, so the existing branch already skips it — just add a sibling check).
- After the stream completes and `acc` is persisted (`page.tsx:350`): if `traceId`, `fetch('/api/traces/' + traceId)`, and on `{ ok:true }` set the last assistant message's `trace`. Wrap in try/catch that silently no-ops on failure.
- Add a `friendlyModel(provider, model)` helper: map `gemini` + a model containing `flash` → `"Gemini Flash"`, `gemini` → `"Gemini"`, `openrouter` → derive a short label from the model slug's last segment; latency rendered as `(latencyMs/1000).toFixed(1) + ' s'`.
- Render the disclosure under the assistant bubble in the message map (`page.tsx:529-550`): a `<button className="trace-row" aria-expanded={open} aria-controls={...}>` showing `{toolCount} tool{s} · {friendlyModel} · {seconds} s`, and a conditionally-rendered `<div className="trace-panel" role="region">` listing `trace.toolCalls`. Track open state per message index (a `Set<number>` in component state, toggled like `historyOpen`).
- Add CSS in `globals.css`: `.trace-row` (mono, `--text-dim`, `--surface` background, `--radius-sm`, full-width, min-height 44px, hover → `--surface-2`); `.trace-panel` (`--surface-2`, `--border-subtle`, padding from `--sp-*`); `.trace-tool` rows (mono name, dim args/result, latency right-aligned); error variant uses `--danger`. Respect `prefers-reduced-motion` on any expand transition (DESIGN.md §7). No `#000`/`#fff`, no Inter/Arial.
- Run the anti-pattern guard before committing.

**Validation:** (builder self-check)
- `grep -c "aquavoy_trace_id" src/app/page.tsx` → ≥ `1`
- `grep -c "/api/traces/" src/app/page.tsx` → ≥ `1`
- `grep -c "trace-row\|trace-panel" src/app/page.tsx` → ≥ `2`
- `grep -c "aria-expanded" src/app/page.tsx` → ≥ `2` (history button + trace row)
- `grep -cE "#000|#fff|font-family:\s*(Inter|Arial|Roboto)" src/app/globals.css` → `0` additions in new rules (DESIGN.md §10)
- `node bin/slop-detect.mjs src/app/page.tsx` → no critical findings
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`

**Context:** Read @src/app/page.tsx, @src/app/globals.css, @src/lib/agents/traces.ts, @.planning/DESIGN.md

**Design:** (REQUIRED — touches .tsx and .css)
- Register: product (internal operations console — DESIGN.md §1 "terminal-native operations console with a maritime skin")
- Tokens used: `var(--surface)`, `var(--surface-2)`, `var(--border-subtle)`, `var(--text)`, `var(--text-dim)`, `var(--text-muted)`, `var(--accent)`, `var(--danger)`, `var(--font-mono)`, `--sp-1`..`--sp-4`, `--radius-sm`, `--ease-out`
- Scope: component (disclosure row + panel under each assistant bubble)
- Anti-pattern guard: builder runs `node bin/slop-detect.mjs src/app/page.tsx` pre-commit; commit blocked on critical findings.

---

## Success Criteria
- [ ] After any agent response, the chat shows a disclosure row (e.g. "3 tools · Gemini Flash · 1.2 s") that expands to a per-tool trace with name, argument summary, and latency — no network tab or log-tailing.
- [ ] `public.agent_traces` has one row per turn with `model`, `provider`, `tool_calls` (JSONB array), `latency_ms`, `prompt_tokens`, `completion_tokens` populated and non-null for every completed turn.
- [ ] A slow or failed tool call is represented in the trace with its actual latency and an `error` field; the trace record is never silently omitted, even when the loop errors mid-turn.
- [ ] The observability layer adds zero new runtime dependencies to the client bundle — all writes happen server-side inside the existing SSE route.

---

## Verification Contract

### Contract for Task 1 — migration exists
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0011_agent_traces.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — RLS on, no policies (service-role lockdown)
**Check type:** command-exit
**Command:** `grep -c "enable row level security" supabase/migrations/0011_agent_traces.sql; grep -cE "create policy" supabase/migrations/0011_agent_traces.sql`
**Expected:** `1` then `0`
**Fail if:** RLS not enabled, or any policy is declared (would breach PROJECT.md:58 "RLS-on/no-policy")

### Contract for Task 1 — trace library exports
**Check type:** grep-match
**Command:** `grep -cE "export async function (insertTrace|getTrace)" src/lib/agents/traces.ts`
**Expected:** `2`
**Fail if:** Either `insertTrace` or `getTrace` is missing

### Contract for Task 2 — loop persists a trace (success + error paths)
**Check type:** grep-match
**Command:** `grep -c "insertTrace" src/lib/openrouter/client.ts`
**Expected:** Non-zero (≥ 2 — success path and catch path)
**Fail if:** Returns 0 — the trace library exists but the loop never writes to it, or < 2 means the mid-turn-error path is not covered (success criterion 3)

### Contract for Task 2 — final stream requests usage + emits trace id
**Check type:** grep-match
**Command:** `grep -c "stream_options" src/lib/openrouter/client.ts; grep -c "aquavoy_trace_id" src/lib/openrouter/client.ts`
**Expected:** `1` then ≥ `1`
**Fail if:** `include_usage` not requested (completion tokens would be 0/null, breaking criterion 2) or the trace id is never emitted into the SSE stream

### Contract for Task 2 — traces fetch route wired and auth-gated
**Check type:** grep-match
**Command:** `grep -c "getTrace" src/app/api/traces/[id]/route.ts; grep -c "getPrincipal" src/app/api/traces/[id]/route.ts`
**Expected:** ≥ `1` then ≥ `1`
**Fail if:** Route does not call `getTrace`, or is not auth-gated by `getPrincipal` (would expose traces to any caller)

### Contract for Task 2 — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation error

### Contract for Task 3 — UI captures trace id and fetches it
**Check type:** grep-match
**Command:** `grep -c "aquavoy_trace_id" src/app/page.tsx; grep -c "/api/traces/" src/app/page.tsx`
**Expected:** ≥ `1` then ≥ `1`
**Fail if:** Returns 0 for either — the trace id is parsed but never fetched, or never captured (disclosure row would have no data)

### Contract for Task 3 — disclosure row rendered and accessible
**Check type:** grep-match
**Command:** `grep -c "trace-row" src/app/page.tsx; grep -c "aria-expanded" src/app/page.tsx`
**Expected:** ≥ `1` then ≥ `2`
**Fail if:** No `.trace-row` element, or the disclosure is not an `aria-expanded` button (REQ-13 keyboard/SR access)

### Contract for Task 3 — no design anti-patterns introduced
**Check type:** command-exit
**Command:** `node bin/slop-detect.mjs src/app/page.tsx 2>&1 | grep -ci "critical" || echo 0`
**Expected:** `0`
**Fail if:** slop-detect reports a critical finding (hardcoded hex, banned font, etc. — DESIGN.md §10)

### Contract for Task 3 — full type check
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation error

### Contract — phase behavioral (verifier QA)
**Check type:** behavioral
**Command:** (manual: log in, send a message that triggers ≥1 tool e.g. "list my inbox", wait for reply)
**Expected:** A disclosure row appears under the reply showing tool count + provider + latency; clicking it expands a per-tool list with name/args/latency; a new `agent_traces` row exists in Supabase with non-null model/provider/latency_ms/prompt_tokens/completion_tokens.
**Fail if:** No disclosure row appears, the panel does not expand, or no `agent_traces` row is written for the turn.
