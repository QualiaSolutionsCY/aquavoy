# Codebase Map

**Scanned:** 2026-06-15
**Repo:** aquavoy (QualiaSolutionsCY/aquavoy)
**LOC:** ~7,200 across 45 TS/TSX files (src/)

## At a Glance

- **Stack:** Next.js 16.2 App Router · React 19.2 · TypeScript 5.9 (strict) · Supabase · Vercel · npm
- **Architecture:** Internal AI assistant for a shipping operation — thin App-Router route handlers delegate to `lib/` services, which delegate to single-vendor adapters; center of gravity is an OpenRouter tool-loop agent with 17 tools.
- **Conventions:** Disciplined and consistent — PascalCase components, camelCase lib files, uniform `{ ok, data }` HTTP envelope via `lib/http.ts`, one adapter file per external seam, Zod-validated env in `lib/env.ts`, conventional-commit messages.
- **Concerns:** 8 total — 0 CRITICAL, 3 HIGH, 3 MEDIUM, 2 LOW. Dominant theme: no app-auth layer (auto-login as hardcoded "Wency", unauthenticated API routes).

## Validated Capabilities (Inferred)

Based on existing code, this project already does:

- **AI agent with tool-loop** — OpenRouter/Gemini, non-streaming tool loop (max 10 iters) then streamed SSE response (evidence: `src/lib/openrouter/client.ts`)
- **17-tool agent registry** fanning out to OneDrive/Outlook/mail/web-search/memory (evidence: `src/lib/agents/onedriveTools.ts`)
- **OneDrive / Microsoft Graph integration** — delegated OAuth, auto-refreshing tokens, file list/search/download/upload/folder/item ops (evidence: `src/lib/microsoft/*`, `src/app/api/onedrive/*`)
- **Outlook send + draft** (evidence: `src/lib/microsoft/outlook.ts`, `src/app/api/outlook/*`)
- **IMAP/SMTP mailbox access** — list/read/search across inbox/sent/drafts, multi-account (evidence: `src/lib/mail/imap.ts`, `src/lib/mail/smtp.ts`, `src/lib/mail/accounts.ts`)
- **Scheduled email queue** — Postgres-backed, drained by per-minute Vercel cron, per-row error isolation (evidence: `src/lib/mail/scheduled.ts`, `src/app/api/mail/scheduled/run/route.ts`)
- **Conversation memory recall** — dual-path: server-side auto-injection per request + callable `recall_memory` tool (evidence: `src/lib/agents/memoryTools.ts`)
- **Document parsing** — Word/PDF/Excel (mammoth, pdf-parse, xlsx)
- **Tavily web search** (evidence: `src/lib/agents/tavily.ts`)
- **Branded UI** — chat, emails, files, prep pages; Nav/Footer (evidence: `src/app/*/page.tsx`)

These become **Validated reqs** in PROJECT.md when `/qualia-new` runs.

## Dimension Details

- [Architecture](./architecture.md)
- [Stack](./stack.md)
- [Conventions](./conventions.md)
- [Concerns](./concerns.md)
- [Onboarding adapter](./onboarding.md)

## Onboarding adapter snapshot

- **Issue tracker:** GitHub (QualiaSolutionsCY/aquavoy); default label set, 2 canonical roles missing (needs-triage, ready-for-agent)
- **Domain docs:** root `README.md` only; no CONTEXT.md/GLOSSARY.md (Qualia will create `.planning/CONTEXT.md`)
- **Existing agent files:** none (CLAUDE.md/AGENTS.md/.cursor/ all absent) — Qualia substrate appends cleanly

## Flagged during scan (facts, not fixes)

- **No app-auth layer** — auto-login as hardcoded principal; every API route except the cron runner is unauthenticated, including `POST /api/chat` whose agent can send mail and mutate OneDrive files. Single-tenant internal tool assumption is undocumented and unenforced. (HIGH — `concerns.md`)
- **Plaintext mailbox passwords + OAuth tokens at rest** — mitigated by service-role-only RLS, but not encrypted. (HIGH)
- **Zero tests** — no test framework configured. (HIGH)
- **Missing migration on disk** — `scheduled.ts` references a scheduled-emails table but migrations stop at `0006_chat_sessions`; likely applied out-of-band. (`architecture.md`)
- **AI provider ambiguity** — silently prefers a direct `GOOGLE_API_KEY`/Gemini endpoint over OpenRouter when present, complicating "which model answered" debugging. (`architecture.md`)
- **Tavily key undocumented** — `tavily.ts` uses a runtime key absent from `.env.example`. (`stack.md`)
