# Aquavoy — Architecture Map

> Aquavoy (a.k.a. Wence / Faial BV) is an inland-waterway shipping operation's
> internal AI assistant. The app is a **Next.js 16 App Router + React 19 + TypeScript**
> single-surface tool that lets two named principals (Wency, Jeanette) chat with an
> AI agent that can: read/organize OneDrive files, read/send/schedule company email,
> recall past conversations, and search the web.
>
> This file maps **what exists and how it is wired**. Every major claim cites `file:line`.

---

## 1. Stack & top-level layout

- **Framework:** Next.js 16 App Router, React 19, TypeScript (`package.json:13-22`).
- **Runtime:** all API routes pin `export const runtime = "nodejs"` + `dynamic = "force-dynamic"` (they touch service-role Supabase, IMAP, SMTP, OAuth — none are edge-safe).
- **Persistence:** Supabase (Postgres) accessed only through a service-role client (`src/lib/supabase/server.ts:12`).
- **Key dependencies:** `imapflow` + `mailparser` (IMAP read), `nodemailer` (SMTP send), `mammoth` / `pdf-parse` / `xlsx` (file text extraction), `zod` (validation) — `package.json:13-22`.
- **Deploy:** Vercel; a cron in `vercel.json:2-7` hits `/api/mail/scheduled/run` every minute.

```
src/
  app/                 ← App Router: pages (client) + API route handlers (server)
    layout.tsx         ← root layout: fonts, Nav, Footer, skip-link
    page.tsx           ← "/" Chat UI (client component, SSE streaming)
    emails/page.tsx    ← mail-account + scheduled-email management UI
    files/page.tsx     ← OneDrive browser UI
    prep/page.tsx      ← recipient/crew + email-prep UI
    api/               ← route handlers (thin wiring — see §3)
  components/          ← Nav.tsx, Footer.tsx (presentational)
  lib/                 ← all business logic & adapters (see §2)
supabase/migrations/   ← 0001..0006 (note: scheduled_emails migration missing — §7)
```

---

## 2. `lib/` subsystems (the substrate)

Code is organized as **layered adapters at external seams**. The general shape is:
route handler (wiring) → service/agent (orchestration) → adapter (vendor IO) → Supabase or external API.

| Folder | File | Role |
|---|---|---|
| `lib/` | `env.ts` | Lazy, **per-feature** env validation with zod (`env.ts:12-21`). Chat can work before OneDrive/mail creds exist — each subsystem has its own `getXEnv()` cache (`env.ts:28,41,53,63,72`). |
| `lib/` | `http.ts` | Uniform `ok()`/`fail()` JSON envelopes + `handle()` wrapper that maps `GraphError` to its HTTP status (`http.ts:5,10,20`). |
| `lib/` | `mailboxes.ts` | Static source of truth: 12 company mailboxes across `aquavoy.com` / `faialbv.com`, plus per-domain IMAP/SMTP host+port defaults (`mailboxes.ts:16,31`). |
| `lib/` | `recipients.ts` | Crew/recipient persistence (Supabase) for the Prep page. |
| `lib/supabase/` | `server.ts` | **The Supabase seam.** Cached service-role client, server-only, bypasses RLS (`server.ts:12-18`). Every DB read/write in the app goes through `supabaseAdmin()`. |
| `lib/openrouter/` | `client.ts` | **The AI seam.** Owns OpenRouter (or Gemini) wire format; system prompt; the tool-call loop (`client.ts:264`) and the streaming variant (`client.ts:128`). |
| `lib/agents/` | `onedriveTools.ts` | **The agent tool registry + executor** — defines all 17 tool schemas and routes each tool call to its subsystem (`onedriveTools.ts:52,571`). |
| `lib/agents/` | `memoryTools.ts` | Conversation recall — `recallMemory` (tool) + `autoRecall` (auto-inject) over `chat_messages` (`memoryTools.ts:20,61`). |
| `lib/agents/` | `tavily.ts` | **Web-search seam.** Only file that knows Tavily's wire format (`tavily.ts:26`). |
| `lib/agents/` | `draftEmail.ts` | Email-drafting helper for the Prep page; calls `complete()` and extracts `{subject,body}` JSON (`draftEmail.ts:46`). |
| `lib/microsoft/` | `oauth.ts` | Microsoft OAuth v2.0 auth-code flow — owns the token endpoint (`oauth.ts:64,79`). |
| `lib/microsoft/` | `graph.ts` | **Graph transport seam.** Base URL, auth header, `GraphError` envelope; `graphJson`/`graphRaw` resolve a fresh token then fetch (`graph.ts:9,11,59,67`). |
| `lib/microsoft/` | `onedrive.ts` | **OneDrive operations seam** in internal `DriveItem` terms: list/get/download/upload(small+chunked)/folder/delete/rename/move/copy/search (`onedrive.ts:52-250`). |
| `lib/microsoft/` | `outlook.ts` | Outlook mail over Graph (send / draft / list inbox) — alternate to IMAP/SMTP, used by `/api/outlook/*`. |
| `lib/microsoft/` | `connections.ts` | Token persistence + **transparent refresh** (`getValidAccessToken`, `connections.ts:108`); `resolveConnectionId` defaults to most-recent account (`connections.ts:90`). |
| `lib/microsoft/` | `types.ts` | Pure domain shapes (`DriveItem`, `GraphDriveItem`, `TokenSet`, `MicrosoftUser`). |
| `lib/mail/` | `accounts.ts` | Mail-account persistence; `MailAccount` (safe) vs `MailAccountWithSecret` (`accounts.ts:15,28`); password never leaves this module except for send/IMAP. |
| `lib/mail/` | `imap.ts` | **IMAP read seam** — only file importing `imapflow`/`mailparser`; connect→op→disconnect per call (`imap.ts:1-19,40`). |
| `lib/mail/` | `smtp.ts` | **SMTP send seam** — only file importing `nodemailer`; `verifySmtp` + `sendMail` (`smtp.ts:1-7,33`). |
| `lib/mail/` | `scheduled.ts` | Scheduled-email queue: `scheduleEmail`/`listScheduled`/`cancelScheduled` + the `runDue()` batch runner (`scheduled.ts:74,104,119,149`). |

---

## 3. Entry points

### 3.1 Root layout & pages

- **`app/layout.tsx`** — sets fonts (Instrument Sans + JetBrains Mono), renders a skip-link, `<Nav/>`, the page, and `<Footer/>` (`layout.tsx:27-39`). Metadata brands it "Aquavoy — Shipping Operations".
- **`app/page.tsx`** — the **Chat UI**, a `"use client"` component. Auto-logs in as "Wency" on mount (`page.tsx:296-301`), hydrates the latest stored session via `/api/chat/history`, streams replies from `/api/chat` by parsing OpenRouter SSE (`page.tsx:245-276`), and fire-and-forgets each message to `/api/chat/history` (`page.tsx:196-202`). Has a history panel (browse past sessions) and "New chat" / "Clear memory" controls.
- **`app/emails/page.tsx`** — connect/verify mail accounts and manage the scheduled-email queue (talks to `/api/mail/*`).
- **`app/files/page.tsx`** — OneDrive browser (talks to `/api/onedrive/*`, uses the `DriveItem` type directly).
- **`app/prep/page.tsx`** — manage recipients/crew and prep 1:1 emails (talks to `/api/recipients` + drafting).
- **Nav** links: Chat `/`, Emails `/emails`, Files `/files`, Prep `/prep` (`components/Nav.tsx:5-10`).

### 3.2 API route handlers (all thin wiring)

| Route | Verbs | Delegates to |
|---|---|---|
| `api/chat/route.ts` | POST | `autoRecall` + `streamChatWithTools` → SSE passthrough (`chat/route.ts:43-58`) |
| `api/chat/history/route.ts` | GET/POST/DELETE | `supabaseAdmin()` on `chat_messages`; GET has 3 modes: latest / `view=sessions` / single `sessionId` (`chat/history/route.ts:34`) |
| `api/onedrive/connect` | GET | `buildAuthorizeUrl`, sets CSRF state cookie (`onedrive/connect/route.ts:11`) |
| `api/onedrive/callback` | GET | verify state → `exchangeCodeForTokens` → `fetchMe` → `saveConnection` (`onedrive/callback/route.ts:14`) |
| `api/onedrive/connections` | GET | `listConnections` (no tokens) |
| `api/onedrive/files` `folder` `item` `download` `upload` `search` | GET/POST/PATCH/DELETE | the `onedrive.ts` operations |
| `api/outlook/send` `draft` | POST | `outlook.ts` over Graph |
| `api/mail/accounts` | GET/POST/DELETE | `accounts.ts`; POST verifies SMTP first (`mail/accounts/route.ts:27`) |
| `api/mail/send` | POST | `smtp.ts` `sendMail` via a stored account |
| `api/mail/scheduled` | GET/POST/DELETE | `scheduled.ts` schedule/list/cancel |
| `api/mail/scheduled/run` | GET | **cron** — bearer-guarded by `CRON_SECRET`, calls `runDue()` (`mail/scheduled/run/route.ts:14-23`) |
| `api/recipients` | GET/POST/DELETE | `recipients.ts` |

---

## 4. Module boundaries (the major subsystems)

```
                         ┌─────────────────────────────┐
        Browser ───────► │ app/page.tsx (Chat, SSE)    │
                         └──────────────┬──────────────┘
                                        │ POST /api/chat
                         ┌──────────────▼──────────────┐
                         │ api/chat/route.ts            │  ← autoRecall injects memory
                         └──────────────┬──────────────┘
                                        │
                   ┌────────────────────▼─────────────────────┐
                   │ lib/openrouter/client.ts                  │
                   │  streamChatWithTools = tool loop + stream │
                   └───────┬───────────────────────┬──────────┘
                           │ TOOL_DEFINITIONS       │ executeTool(name,args)
                           └───────────┬────────────┘
                                       ▼
                   ┌──────────────────────────────────────────┐
                   │ lib/agents/onedriveTools.ts  (tool router)│
                   └──┬─────────┬─────────┬─────────┬──────────┘
        OneDrive ─────┘  web ───┘ memory ─┘  mail ──┘
   microsoft/onedrive  agents/   agents/   mail/imap, mail/smtp,
   + graph + oauth     tavily    memoryTools  mail/scheduled, mail/accounts
   + connections                  (Supabase)   (Supabase + IMAP/SMTP)
```

Five subsystems hang off the single tool router:

1. **AI agent core** (`lib/openrouter/`) — provider-pluggable: a funded `GOOGLE_API_KEY` routes to Gemini's OpenAI-compatible endpoint, otherwise OpenRouter; both are OpenAI-wire-compatible so the tool loop is unchanged (`client.ts:209-226`). Supports OpenRouter `models` fallback list (`client.ts:232-239`).
2. **Microsoft Graph / OneDrive / Outlook** (`lib/microsoft/`) — delegated OAuth; tokens in `onedrive_connections`; auto-refresh; all file ops in `DriveItem` terms. README documents the seam (`README.md:16-31`).
3. **IMAP/SMTP mail** (`lib/mail/`) — direct mailbox access (no Graph) using stored per-account credentials; read via IMAP, send via SMTP.
4. **Memory recall** (`lib/agents/memoryTools.ts`) — both a callable tool and an automatic server-side injection.
5. **Scheduled email queue** (`lib/mail/scheduled.ts` + cron) — a Postgres-backed queue drained by a per-minute Vercel cron.

The boundaries are real: only `imap.ts` imports `imapflow` (`imap.ts:1-19`); only `smtp.ts` imports `nodemailer` (`smtp.ts:1-7`); only `tavily.ts` knows Tavily; only `graph.ts`/`onedrive.ts` know Graph. Swapping a vendor is a one-file change.

---

## 5. Data flows (the three load-bearing paths)

### 5.1 Chat request → agent → tools → final stream

1. `app/page.tsx` POSTs `{ messages, identity }` to `/api/chat` (`page.tsx:230-238`).
2. The route filters/whitelists messages and **whitelists `identity`** against `PRINCIPALS` before it ever touches the prompt (`chat/route.ts:24-31`).
3. If a principal is set, `autoRecall(identity, lastUserMsg)` greps `chat_messages` for ≥5-char salient words and prepends a `system` note with matching past snippets — soft-fails silently (`chat/route.ts:43-49`, `memoryTools.ts:61-100`).
4. `streamChatWithTools` runs a **non-streaming tool loop** up to `MAX_TOOL_ITERATIONS = 10` (`client.ts:16,280`): each round sends history + `TOOL_DEFINITIONS`; while `finish_reason === "tool_calls"` it executes each call via `executeTool` and appends `role:"tool"` results (`client.ts:308-342`).
5. When the model stops calling tools, a **final streaming call** (tools dropped) returns the upstream `Response`, piped straight to the browser as `text/event-stream` (`client.ts:347-364`, `chat/route.ts:51-58`). The client parses `data:` SSE lines incrementally (`page.tsx:251-276`).
6. The system prompt (`client.ts:56-122`) defines the persona, capabilities, the **confirm-before-send/schedule/delete** rules, and known drive layout (e.g. invoices live in `Verzonden Facturen`). `buildSystemContent` appends current UTC time + Europe/Amsterdam timezone guidance (`client.ts:241-247`).

### 5.2 OneDrive OAuth connect → callback → use

1. `GET /api/onedrive/connect` mints a CSRF `state`, stores it in an httpOnly cookie, and redirects to Microsoft's authorize URL (`onedrive/connect/route.ts:11-23`, `oauth.ts:16-29`).
2. Microsoft redirects to `GET /api/onedrive/callback`; it verifies `state` against the cookie, `exchangeCodeForTokens(code)`, `fetchMe(accessToken)`, then `saveConnection` upserts a row in `onedrive_connections` keyed by `ms_user_id` (`onedrive/callback/route.ts:32-37`, `connections.ts:47-69`).
3. Any later Graph call resolves a connection id (defaulting to most-recent — `connections.ts:90`) and calls `getValidAccessToken`, which refreshes + re-persists tokens within a 60s skew window before expiry (`connections.ts:108-129`). README §"Notes" documents the delegated→app-only swap path (`README.md:88-92`).

### 5.3 Scheduled email queue + cron runner

1. The agent's `schedule_email` tool validates the time (future, valid ISO) and calls `scheduleEmail`, which first confirms the `from` address maps to a connected account, then inserts a `pending` row in `scheduled_emails` (`onedriveTools.ts:699-730`, `scheduled.ts:74-99`).
2. `vercel.json` runs `GET /api/mail/scheduled/run` every minute (`vercel.json:2-7`). The route is bearer-guarded by `CRON_SECRET` (`mail/scheduled/run/route.ts:18`).
3. `runDue()` selects up to 20 `pending` rows with `scheduled_at <= now()`, sends each via SMTP with **per-row error isolation** (one failure never aborts the batch), and flips status to `sent`/`failed` (`scheduled.ts:149-197`).
4. Users see/cancel the queue through `/api/mail/scheduled` and the Emails page, or the agent's `list_scheduled_emails` / `cancel_scheduled_email` tools.

---

## 6. External seams (where the system meets the outside world)

| Seam | Adapter file | Auth / env | Notes |
|---|---|---|---|
| **OpenRouter / Gemini (AI)** | `lib/openrouter/client.ts` | `OPENROUTER_API_KEY` (+ `OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODELS`) or `GOOGLE_API_KEY`+`GEMINI_MODEL` (`env.ts:36-43`, `client.ts:209`) | OpenAI-wire-compatible; OpenRouter `web` plugin only on the `complete()` path (`client.ts:166`). |
| **Microsoft Graph** | `lib/microsoft/graph.ts` + `onedrive.ts` + `outlook.ts` | `MICROSOFT_CLIENT_ID/_SECRET/_TENANT_ID/_SCOPES` (`env.ts:46-51`) | Delegated OAuth; scopes include `Files.ReadWrite.All Mail.ReadWrite Mail.Send offline_access`. Base `https://graph.microsoft.com/v1.0`. |
| **IMAP (read mail)** | `lib/mail/imap.ts` | per-account creds in `mail_accounts`; hosts default from `mailboxes.ts` | TLS port 993; connect-per-call, read-only. |
| **SMTP (send mail)** | `lib/mail/smtp.ts` | per-account creds in `mail_accounts` | nodemailer; port 465 = secure, else requireTLS. |
| **Supabase (DB)** | `lib/supabase/server.ts` | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`env.ts:58-61`) | Service-role only, server-only; tables RLS-on with no public policies. |
| **Tavily (web search)** | `lib/agents/tavily.ts` | `TAVILY_API_KEY` (`env.ts:68-71`) | Returns AI answer + top-5 sources; never throws. |

---

## 7. Notable wiring facts for a new engineer

- **Identity is a whitelist, not auth.** There is no user login; the two principals (Wency, Jeanette) are a hardcoded set used to scope memory and personalize the prompt (`client.ts:43-44`, `chat/route.ts:27-31`). The chat auto-logs-in as Wency (`page.tsx:296-301`).
- **Single shared OneDrive / mailbox set.** Connections and mail accounts are global rows, not per-user; tools default to the most-recently-connected OneDrive account (`connections.ts:90`). README flags the eventual `auth.uid()` + RLS migration (`README.md:91-92`).
- **Memory is dual-path.** `autoRecall` injects context on *every* chat request server-side (`chat/route.ts:46`), AND the model can explicitly call `recall_memory` (`onedriveTools.ts:666-672`) — the auto path removes the "model forgot to check memory" failure mode.
- **Two parallel mail stacks coexist.** Graph/Outlook (`lib/microsoft/outlook.ts`, `/api/outlook/*`) and direct IMAP/SMTP (`lib/mail/*`, the agent tools). The agent's read/send/schedule tools use the IMAP/SMTP stack, not Graph.
- **Migration gap (verify before relying on it):** `scheduled.ts:7` and `accounts.ts` reference `scheduled_emails` (`0007`) and `mail_accounts` tables, but `supabase/migrations/` only contains `0001_onedrive_connections` … `0006_chat_sessions` — there is **no `0007_scheduled_emails.sql`** on disk (`ls supabase/migrations` → 0001..0006). The scheduled-email queue's table may have been applied out-of-band rather than via a tracked migration.
- **Provider flexibility is intentional:** the AI layer silently prefers a direct Gemini key over OpenRouter when present (`client.ts:210-218`) — worth knowing when debugging which model actually answered.
