# Aquavoy

Internal AI assistant for **Aquavoy Shipping / Faial BV** — a small inland-waterway
shipping operation in the Netherlands. Built by Qualia Solutions.

## What Aquavoy is

Two named operators run the back office by talking to an agent instead of hopping
between OneDrive, a dozen mailboxes, and manual email drafting. The whole product
is one chat surface plus three supporting pages. Through chat the agent can:

- **Read and organize OneDrive** via Microsoft Graph — browse, search, download,
  upload, create folders, rename/move/copy, delete.
- **Read, send, and schedule email** across 12 company mailboxes (aquavoy.com /
  faialbv.com), with confirm-before-send/schedule/delete guardrails.
- **Recall past conversations** — memory is injected per request and is also a
  callable tool.
- **Search the web** for facts the operators need.

Supporting pages (Emails, Files, Prep) give a direct UI over the same surfaces the
agent drives.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5** (strict)
- **Supabase** — service-role, server-only (token storage, conversation memory,
  scheduled-email queue)
- **Microsoft Graph** v1.0 — OneDrive operations via delegated OAuth
- **imapflow / mailparser / nodemailer** — IMAP read + SMTP send across mailboxes
- **OpenRouter / Gemini** — the agent's LLM, provider-pluggable
- **Tavily** — web search
- **Vercel** — hosting + per-minute cron for the scheduled-email queue

## Pages

| Route     | Source                  | What it is                                          |
|-----------|-------------------------|-----------------------------------------------------|
| `/`       | `src/app/page.tsx`      | Chat — the primary surface; talk to the agent       |
| `/emails` | `src/app/emails/page.tsx` | Inbox view across the company mailboxes           |
| `/files`  | `src/app/files/page.tsx`  | OneDrive file browser                             |
| `/prep`   | `src/app/prep/page.tsx`   | Email-prep — crew/recipient lists + 1:1 drafting  |
| `/login`  | `src/app/login/page.tsx`  | Auth gate for the named operators                 |

## Local development

```bash
npm install
cp .env.example .env.local   # then fill it in — see docs/env-reference.md
npx supabase link            # link to the Aquavoy Supabase project
npx supabase db push         # apply supabase/migrations
npm run dev                  # http://localhost:3000
```

Useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
```

### Microsoft app registration (Entra / Azure AD)

OneDrive OAuth needs a Microsoft app registration:

1. https://entra.microsoft.com → **App registrations** → **New registration**.
2. Supported accounts: pick the type that matches `MICROSOFT_TENANT_ID`
   (`common` = work/school **and** personal).
3. **Redirect URI** (Web): `http://localhost:3000/api/onedrive/callback`
   (and your production URL later).
4. **Certificates & secrets** → new client secret → copy the value.
5. **API permissions** → Microsoft Graph → **Delegated**:
   `offline_access`, `User.Read`, `Files.ReadWrite.All` → grant admin consent if
   the tenant requires it.

## Operating the app

Day-to-day operation — connecting OneDrive, mailbox configuration, the
scheduled-email cron, and recovery steps — is in **[docs/operator-runbook.md](docs/operator-runbook.md)**.

## Documentation

- **[docs/operator-runbook.md](docs/operator-runbook.md)** — running and operating the app
- **[docs/env-reference.md](docs/env-reference.md)** — every environment variable explained
- **[docs/architecture.md](docs/architecture.md)** — how the pieces fit together

---

Built by [Qualia Solutions](https://qualiasolutions.net)
