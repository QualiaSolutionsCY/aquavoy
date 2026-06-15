# Tech Stack — Aquavoy

Aquavoy (Wence) — AI agent platform with OneDrive / Microsoft Graph integration (`package.json:5`).

All versions below are the **resolved** versions from `package-lock.json` (lockfileVersion 3), not the `^` ranges in `package.json`.

## Runtime

- **Node**: no version pinned — no `engines` field in `package.json`, no `.nvmrc` / `.node-version` present. Defaults to the platform/Vercel Node version.
- **Package manager**: npm — only `package-lock.json` is present (`package-lock.json:1`); no `pnpm-lock.yaml`, `yarn.lock`, or `bun.lockb`.

## Framework

- **Next.js**: `16.2.7` (resolved; `package.json:17` declares `^16.0.0`).
- **React**: `19.2.7` / **React DOM**: `19.2.7` (resolved; `package.json:20-21` declare `^19.0.0`).
- **App Router**: yes — `next.config.ts:1` uses `NextConfig`; `tsconfig.json:26-28` maps `@/*` → `./src/*` and the lib tree lives under `src/lib/` with `src/app/api/...` route handlers (e.g. `vercel.json:4` cron points at `/api/mail/scheduled/run`).
- **Turbopack**: workspace root pinned to `__dirname` to avoid a stray parent lockfile mis-rooting the build (`next.config.ts:7`).
- `reactStrictMode: true` (`next.config.ts:4`).

## Language

- **TypeScript**: `5.9.3` (resolved; `package.json:32` declares `^5.6.0`).
- **Strictness**: `strict: true` (`tsconfig.json:11`), `isolatedModules: true` (`tsconfig.json:17`), `noEmit: true` (`tsconfig.json:12`).
- **Target / module**: `target: ES2022` (`tsconfig.json:3`), `module: esnext`, `moduleResolution: bundler` (`tsconfig.json:14-15`), `jsx: react-jsx` (`tsconfig.json:18`).
- Path alias `@/*` → `./src/*` (`tsconfig.json:25-29`).
- Typecheck script: `tsc --noEmit` (`package.json:10`).

## Key libraries (by purpose)

### AI
- **OpenRouter** — custom fetch-based adapter, **no SDK dependency**. There is no `openai`/`@anthropic`/Graph SDK in `package.json`. The adapter owns OpenRouter's wire format, headers, and base URL `https://openrouter.ai/api/v1/chat/completions` directly (`src/lib/openrouter/client.ts:1-12`), with an OpenAI-style tool-calling loop (`MAX_TOOL_ITERATIONS = 10`, `src/lib/openrouter/client.ts:15`). Default model from env is `google/gemini-3.5-flash` (`.env.example:22`); a Gemini-compatible endpoint constant also appears (`src/lib/openrouter/client.ts:194`).

### Microsoft Graph / OneDrive
- **Fetch-based, no SDK** — no `@microsoft/microsoft-graph-client`, `@azure/msal-*`, or `isomorphic-fetch` in `package.json`. A thin transport adapter owns the base URL `https://graph.microsoft.com/v1.0` and a `GraphError` envelope (`src/lib/microsoft/graph.ts:9-19`), with `onedrive.ts` / `outlook.ts` / `oauth.ts` / `connections.ts` layered on top (`src/lib/microsoft/`). Delegated OAuth against `login.microsoftonline.com` (`src/lib/microsoft/oauth.ts`).

### Mail
- **imapflow** `1.4.0` (`package.json:14`) — IMAP read/list/search (`src/lib/mail/imap.ts`).
- **mailparser** `3.9.9` (`package.json:15`) — message parsing; `@types/mailparser` `3.4.6` (`package.json:26`).
- **nodemailer** `8.0.11` (`package.json:18`) — SMTP send (`src/lib/mail/smtp.ts`); `@types/nodemailer` `8.0.1` (`package.json:28`).

### Document parsing
- **mammoth** `1.12.0` (`package.json:16`) — DOCX → text/HTML.
- **pdf-parse** `2.4.5` (`package.json:19`) — PDF text extraction; `@types/pdf-parse` `1.1.5` (`package.json:29`).
- **xlsx** `0.18.5` (`package.json:22`) — spreadsheet parsing.

### Validation
- **zod** `3.25.76` (`package.json:23`).

### Supabase
- **@supabase/supabase-js** `2.108.0` (`package.json:13`). Server adapter constructs a service-role client (`src/lib/supabase/server.ts:1,15`) — used for OAuth token / mail-account storage, server-only.

## Database

- **Supabase** (Postgres). Migrations live in `supabase/migrations/` (6 files, sequential):
  - `0001_onedrive_connections.sql`
  - `0002_recipients.sql`
  - `0003_mail_accounts.sql`
  - `0004_chat_messages.sql`
  - `0005_fix_mail_accounts_on_conflict.sql`
  - `0006_chat_sessions.sql`
- No `supabase/config.toml`, seed, or functions directory observed — only the migrations folder.

## Hosting

- **Vercel**. `.vercelignore` excludes `.env*`, `.next`, `node_modules` (`.vercelignore:1-5`).
- **Cron**: one job in `vercel.json` — `path: /api/mail/scheduled/run`, `schedule: * * * * *` (every minute) for the scheduled-email queue runner (`vercel.json:2-7`).

## Env vars (categories — keys only, no secret values)

From `.env.example`:
- **App** — `APP_BASE_URL` (used to build the OAuth redirect URI) (`.env.example:1-3`).
- **Microsoft Graph / OneDrive (delegated OAuth)** — `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (default `common`), `MICROSOFT_SCOPES` (`offline_access User.Read Files.ReadWrite.All Mail.ReadWrite Mail.Send`) (`.env.example:5-17`).
- **OpenRouter (AI)** — `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `google/gemini-3.5-flash`) (`.env.example:19-22`).
- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, flagged NEVER expose to client) (`.env.example:24-28`).

Note: `.env.example` does not document IMAP/SMTP credentials — mail-account credentials are stored per-account in Supabase (`supabase/migrations/0003_mail_accounts.sql`, `src/lib/mail/accounts.ts`), not as global env vars. A web search / Tavily key may also be needed at runtime (`src/lib/agents/tavily.ts`) though it is not in `.env.example`.

## CI

- **None.** No `.github/` directory or workflows present. Deploys are CLI-driven (Vercel), consistent with the no-auto-deploy infrastructure policy.
