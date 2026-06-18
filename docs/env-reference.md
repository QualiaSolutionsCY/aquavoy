# Environment Variable Reference

The authoritative contract is **`src/lib/env.ts`** (Zod schemas, validated lazily per
subsystem) plus a handful of direct `process.env` reads. `.env.example` is the template;
`docs/env-reference.md` (this file) explains what each variable is for.

Validation is **per feature**: a missing OneDrive credential does not stop the chat from
working. Each schema throws only when its own subsystem is first used.

> **Mailbox passwords are NOT environment variables.** SMTP/IMAP credentials are stored
> per-mailbox in Supabase (`mail_accounts`), encrypted at rest with `ENCRYPTION_KEY` via
> `src/lib/crypto/secrets.ts`. The public interface never exposes them. See
> `src/lib/mail/accounts.ts` (`loadAccountWithSecret`, `saveAccount`).

## Variable table

| Variable | Required | Server-only | Source / Default | Purpose |
|---|---|---|---|---|
| `APP_BASE_URL` | Yes | No | none — must be a valid URL | Public base URL of the app; used to build the OneDrive OAuth redirect URI (`{APP_BASE_URL}/api/onedrive/callback`). |
| `OPENROUTER_API_KEY` | Yes (for chat) | **Yes** | none | API key for OpenRouter; all conversational LLM calls route through it. |
| `OPENROUTER_MODEL` | No | **Yes** | default `google/gemini-3.5-flash` | Primary model id used for OpenRouter chat completions. |
| `OPENROUTER_FALLBACK_MODELS` | No | **Yes** | none (empty) — comma-separated list | Extra model ids appended to the OpenRouter fallback chain (`src/lib/openrouter/client.ts`). |
| `GOOGLE_API_KEY` | Yes (for embeddings + Gemini direct) | **Yes** | none | Google API key. Powers durable-memory embeddings and the direct Gemini path in `src/lib/openrouter/client.ts`. |
| `GEMINI_MODEL` | No | **Yes** | default `gemini-3.5-flash` | Model id for the direct Gemini call path (`src/lib/openrouter/client.ts`). |
| `MICROSOFT_CLIENT_ID` | Yes (for OneDrive) | **Yes** | none | Azure app registration client id for Microsoft Graph / OneDrive delegated OAuth. |
| `MICROSOFT_CLIENT_SECRET` | Yes (for OneDrive) | **Yes** | none | Client secret for the Microsoft Graph app registration. |
| `MICROSOFT_TENANT_ID` | No | **Yes** | default `common` | Azure tenant: `common` (work + personal), `organizations`, `consumers`, or a tenant GUID. |
| `MICROSOFT_SCOPES` | No | **Yes** | default `offline_access User.Read Files.ReadWrite.All Mail.ReadWrite Mail.Send` | Space-separated delegated scopes. `offline_access` is required for refresh tokens. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | No | none — must be a valid URL | Supabase project URL. `NEXT_PUBLIC_` so it is safe in the client bundle. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | No | none | Supabase publishable (anon) key for any client-side Supabase access. `NEXT_PUBLIC_` — safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Yes — NEVER client** | none | Service-role key used by `src/lib/supabase/server.ts` for all server mutations (token storage, `mail_accounts`). Must never be prefixed `NEXT_PUBLIC_` or imported into a client component. |
| `SESSION_SECRET` | Yes | **Yes** | none — min 32 chars (`openssl rand -base64 48`) | HMAC key that signs the operator session cookie (ADR-001). |
| `OPERATOR_CREDENTIALS` | Yes | **Yes** | none — JSON map | JSON map of `principal → "saltHex:hashHex"` scrypt hashes (64-byte hash). Never store plaintext passwords. Principals: Wency, Jeanette. |
| `ENCRYPTION_KEY` | Yes | **Yes** | none — 32-byte base64 (`openssl rand -base64 32`) | AES-256-GCM master key (`src/lib/crypto/secrets.ts`) for encrypting mailbox passwords and OAuth tokens at rest. Store durably — data is unrecoverable if lost. |
| `TAVILY_API_KEY` | Yes (for web research) | **Yes** | none | API key for Tavily web search (`getTavilyEnv`). |
| `EMBEDDING_MODEL` | No | **Yes** | default `gemini-embedding-001` | Embedding model id for durable-memory semantic recall (overridable per ADR-002 §3 adapters-at-seams). |
| `EMBEDDING_DIM` | No | **Yes** | default `768` | Embedding output dimension. MUST match the `vector(N)` column in `0009_memory_facts.sql` (768). |
| `CRON_SECRET` | Yes (required in prod) | **Yes** | none | Bearer token guarding the cron endpoints (`/api/mail/scheduled/run`, `/api/memory/sweep`). Requests without a matching `Bearer {CRON_SECRET}` get 401. Set in Vercel env vars. |

## Notes

- **Server-only secrets** (`OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `MICROSOFT_CLIENT_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `OPERATOR_CREDENTIALS`, `ENCRYPTION_KEY`,
  `TAVILY_API_KEY`, `CRON_SECRET`) must never be exposed to the browser. Only the two
  `NEXT_PUBLIC_*` Supabase values are intended for the client bundle.
- The embedding provider is config behind `src/lib/embeddings` — swap models/dimensions
  via `EMBEDDING_MODEL` / `EMBEDDING_DIM` without touching feature code (ADR-002).
- After editing schema env defaults, keep `.env.example` in sync so
  `cp .env.example .env.local` yields a complete template.
