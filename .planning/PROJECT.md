# PROJECT — Aquavoy

**Client:** Wence — Aquavoy Shipping Ltd / Faial BV (inland-waterway shipping operation, Netherlands). Internal tool. Built by Qualia Solutions.
**Type:** ai-agent (single-surface internal AI assistant)
**Shape:** Full project (multi-milestone arc → Handoff)
**Mapped:** 2026-06-15 (brownfield — see `.planning/codebase/`)

## What We're Building

An internal AI assistant for a small inland-waterway shipping operation. Two named operators (Wency, Jeanette) chat with an agent that can read and organize OneDrive files, read/send/schedule company email across 12 mailboxes, recall past conversations, and search the web — all behind a single chat surface with supporting management pages (Emails, Files, Prep).

## Core Value

One conversational surface that replaces hopping between OneDrive, a dozen mailboxes, and manual email drafting. The agent does the file-finding, the inbox-reading, and the email-sending — with confirm-before-send/schedule/delete guardrails — so the operators run the back office by talking to it.

## Validated Requirements (shipped — from codebase map)

- **VAL-1** AI agent with OpenAI-wire tool loop (max 10 iters) + streamed SSE reply — `src/lib/openrouter/client.ts`
- **VAL-2** Provider-pluggable AI: Gemini direct or OpenRouter (with fallback list) — `client.ts:209`
- **VAL-3** 17-tool agent registry routing to OneDrive/Outlook/mail/web/memory — `src/lib/agents/onedriveTools.ts`
- **VAL-4** OneDrive via Microsoft Graph: delegated OAuth, auto-refresh, full file surface (list/get/download/upload/folder/rename/move/copy/delete/search) — `src/lib/microsoft/*`
- **VAL-5** IMAP read + SMTP send across 12 company mailboxes (aquavoy.com / faialbv.com) — `src/lib/mail/*`, `src/lib/mailboxes.ts`
- **VAL-6** Scheduled-email queue drained by per-minute Vercel cron, per-row error isolation — `src/lib/mail/scheduled.ts`, `vercel.json`
- **VAL-7** Conversation memory: auto-injected per request + callable `recall_memory` tool — `src/lib/agents/memoryTools.ts`
- **VAL-8** Document text extraction (Word/PDF/Excel) — mammoth / pdf-parse / xlsx
- **VAL-9** Web search via Tavily — `src/lib/agents/tavily.ts`
- **VAL-10** Email-prep page: crew/recipient persistence + 1:1 draft generation — `src/app/prep/page.tsx`, `src/lib/agents/draftEmail.ts`
- **VAL-11** Branded maritime UI (Chat / Emails / Files / Prep), OKLCH dark-ocean design system, a11y skip-link, reduced-motion — `src/app/globals.css`

## Active Requirements (this journey — proposed, pending approval)

See `.planning/JOURNEY.md` / `ROADMAP.md`. Headline themes:
- Harden the trust boundary (real access control on the powerful unauthenticated API surface)
- Encrypt credentials/tokens at rest
- Establish a seam-level test safety net
- Resolve migration drift (`scheduled_emails` table not tracked on disk)

## Out of Scope (for now)

- Multi-tenant / public SaaS (single-tenant internal tool by design)
- Replacing the delegated-OAuth model with app-only client-credentials (documented path exists; not needed yet)
- Mobile-native app (responsive web is sufficient)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict) · Supabase (service-role, server-only) · Microsoft Graph v1.0 · imapflow/mailparser/nodemailer · OpenRouter/Gemini · Tavily · Vercel (cron). npm. See `.planning/codebase/stack.md`.

## Design Direction

Existing shipped system: **maritime operations console** — OKLCH dark-ocean ground (hue 220), teal accent (hue 192), Instrument Sans + JetBrains Mono. Reverse-engineered into `.planning/DESIGN.md`; new work conforms to it, does not replace it.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| App model | Single-tenant, named-principal whitelist | Two operators, one company; no public users |
| AI access | OpenRouter, Gemini direct allowed | Per infra rules; Gemini fast/cheap default |
| DB access | Supabase service-role only, RLS-on/no-policy | No app-auth yet; service-role lockdown |
| Mail stack | Direct IMAP/SMTP for agent tools | Full mailbox control beyond Graph |
