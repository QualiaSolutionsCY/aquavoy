---
phase: 1
goal: "A developer or operator arriving at the repo cold can understand the architecture, operate the agent, and run a local dev environment using only the README, operator runbook, env-var reference, and ADR index — all accurate to the real code."
tasks: 3
waves: 1
---

# Phase 1: Documentation Pass

**Goal:** A maintainer or operator can orient from the repo + docs alone — README (what Aquavoy is, local dev, page/route map), an operator runbook (chat, confirm/undo, the 12 mailboxes, OneDrive OAuth, scheduled email/cron), an env-var reference covering every variable, and an ADR index linking ADR-001..004 — with no claim that diverges from the running code.
**Why this phase:** This is the first phase of the Handoff milestone (REQ-19). The current `README.md` describes only the OneDrive integration (`README.md:5-6 — "Current scope: a OneDrive / Microsoft Graph integration"`) and predates the agent chat, the 4 pages, the mail stack, auth, encryption, and 9 of the 11 env vars. There is no `docs/` directory (`ls docs/` → "No such file or directory") and no ADR index. Until the docs match reality, the client cannot own the system.

> **Grounding note for all tasks:** Every factual claim in a doc MUST match the code. The authoritative env contract is `src/lib/env.ts` (Zod schemas), NOT `.env.example` — `.env.example` is itself stale (missing `CRON_SECRET`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_FALLBACK_MODELS`, `TAVILY_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`). Mailbox passwords are NOT env vars — they live encrypted in the Supabase `mail_accounts` table (`src/lib/mail/accounts.ts:13,98`). No "TODO"/"FIXME"/"placeholder"/"coming soon" text may remain in any doc this phase produces (success criterion 5).

## Task 1 — Rewrite README.md as accurate repo orientation
**Wave:** 1
**Persona:** none
**Files:** `README.md` (full rewrite — currently OneDrive-only, `README.md:5-6`)
**Depends on:** none

**Why:** REQ-19 success criterion 1 — a developer with Next.js experience must be able to clone, configure, and run the app locally from the README alone. The current README's `## Setup` only covers Microsoft + Supabase and stops at "Connect OneDrive" (`README.md:65`); it never mentions the agent chat, login/auth, the four pages, the mail stack, or the cron. Per `rules/architecture.md` §7, the README is orientation only — what the app is, how to run it, where the source of truth for everything else lives — NOT exhaustive API docs.

**Acceptance Criteria:**
- README opens by describing Aquavoy as it actually is: an internal AI assistant for an inland-waterway shipping operation, a single chat surface plus Emails/Files/Prep pages, that reads/organizes OneDrive, reads/sends/schedules email across 12 mailboxes, recalls past conversations, and searches the web (matches `.planning/PROJECT.md:10`).
- README has a "Local development" section: `npm install` → fill `.env.local` (points the reader to the env-var reference, not an inline dump) → `npm run dev` (the real dev script, `package.json` `"dev": "next dev"`) → app at `http://localhost:3000`. It also names `npm run typecheck` and `npm run test` (the real scripts in `package.json`).
- README has a "Pages" section mapping the four routes that actually exist: `/` (Chat — `src/app/page.tsx`), `/emails` (`src/app/emails/page.tsx`), `/files` (`src/app/files/page.tsx`), `/prep` (`src/app/prep/page.tsx`), and `/login` (`src/app/login/page.tsx`) as the auth gate.
- README has a "Documentation" section that links to `docs/operator-runbook.md` (Task 2), `docs/env-reference.md` (Task 3), and `docs/architecture.md` (Task 3, the ADR index) — by relative path.
- No invented routes or features: every page/route named exists under `src/app/`. The Supabase setup step references `npx supabase` (CLI-first per `rules/infrastructure.md`).

**Action:** Replace the entire file. Keep the existing accurate stack facts (Next.js 16 / React 19 / TypeScript / Supabase service-role / Microsoft Graph — `README.md:11-14`, `.planning/PROJECT.md:46`) and the Microsoft app-registration steps (`README.md:34-45` are still correct for OneDrive OAuth). Add the agent + pages reality. Sections to include, in order: title + one-paragraph "What Aquavoy is", "Stack", "Pages" (route table from `src/app/`), "Local development" (install → env → migrations via `npx supabase` → `npm run dev`), "Operating the app" (one line each pointing to the runbook), "Documentation" (links to the three docs), "Built by Qualia Solutions" footer. Do NOT inline the full env list — point to `docs/env-reference.md`. Do NOT copy the old `## API` route table verbatim if it has gone stale; if you keep an API table, every row must match a real `route.ts` under `src/app/api/` (confirmed routes include `/api/chat`, `/api/login`, `/api/actions`, `/api/mail/send`, `/api/mail/scheduled`, `/api/onedrive/*`).

**Validation:** (builder self-check)
- `grep -ci "chat" README.md` → ≥ 1 (the chat surface is described)
- `grep -c "docs/operator-runbook.md" README.md` → ≥ 1 (runbook linked)
- `grep -c "npm run dev" README.md` → ≥ 1 (real dev command present)
- `grep -Eci "TODO|FIXME|placeholder|coming soon" README.md` → 0

**Context:** Read @.planning/PROJECT.md, @README.md, @package.json, and list @src/app to confirm the route/page map before writing.

## Task 2 — Write the operator runbook
**Wave:** 1
**Persona:** none
**Files:** `docs/operator-runbook.md` (new — `docs/` does not yet exist)
**Depends on:** none

**Why:** REQ-19 success criterion 2 — Wency and Jeanette must be able to operate the agent without Qualia. The confirm/undo enforcement is the most operationally important behavior to document: destructive tools (`send_email`, `schedule_email`, `delete_item`, `move_item`, `rename_item`) never execute inside the model loop; they stage a `pending_actions` row and run only via the human-triggered confirm endpoint (ADR-003: `.planning/decisions/ADR-003-enforced-confirm-undo.md:24-44`, routes at `src/app/api/actions/confirm/route.ts` and `.../undo/route.ts`). An operator who doesn't know this will think the agent is broken when it "won't just send."

**Acceptance Criteria:**
- A "Starting and driving the chat" section: log in at `/login` (named principals Wency, Jeanette — `.env.example:36`), open the chat at `/`, type a request, the agent runs tools and streams a reply.
- A "Confirm / Undo" section that states accurately: destructive actions (send email, schedule email, delete/move/rename a OneDrive item) are NEVER executed automatically — the agent stages them and shows a confirmation card; the operator clicks Confirm to actually run it, or Cancel to drop it; an undo is available for reversible confirmed actions (`.planning/decisions/ADR-003-enforced-confirm-undo.md:30-44`). `create_folder` and read-only tools are not gated.
- A "Tool-trace row" section: the chat shows a disclosure row of which tools ran (the trace surface — `/api/traces/[id]` exists at `src/app/api/traces/[id]/route.ts`); explain it is for transparency/audit.
- A "The 12 company mailboxes" section: list all 12 addresses by domain group exactly as in `src/lib/mailboxes.ts:31-47` (7 on aquavoy.com: info, admin, wdr, aquadonna, reizen, crewing, crew; 5 on faialbv.com: info, administratie, prideoffaial, hr, crew). State that IMAP/SMTP is the authoritative stack for these company mailboxes per ADR-004 (`.planning/decisions/ADR-004-mail-stack.md:1,16-18`), Outlook is for user-personal mail only, and mailbox credentials are stored encrypted in Supabase (`mail_accounts`), not in env files (`src/lib/mail/accounts.ts:13,98`). Managed from the Emails page (`/emails`).
- A "OneDrive connection" section: how delegated OAuth works (connect via `/api/onedrive/connect`, return via `/api/onedrive/callback`), that tokens auto-refresh (`src/lib/microsoft/connections.ts:107`), and what to do if a connection stops working (re-connect the account).
- A "Scheduled email & cron" section: scheduled emails are drained every minute by the Vercel cron at `/api/mail/scheduled/run`, protected by a `CRON_SECRET` bearer check (`vercel.json`, `src/app/api/mail/scheduled/run/route.ts:16`); a second cron at `/api/memory/sweep` runs every 5 minutes (`vercel.json`).
- No "TODO"/"FIXME"/"placeholder" text remains.

**Action:** Create `docs/operator-runbook.md`. Write for a non-developer operator — plain language, no code internals beyond the route names they'd see in the URL bar or need to mention to support. Pull every mailbox address verbatim from `src/lib/mailboxes.ts`. Pull the confirm/undo and gated-tool list verbatim from ADR-003. Pull the IMAP-authoritative/Outlook-personal split from ADR-004. Pull the cron schedules from `vercel.json`. Do not invent UI labels you have not confirmed; describe behavior, not exact button pixels.

**Validation:** (builder self-check)
- `grep -c "prideoffaial@faialbv.com" docs/operator-runbook.md` → ≥ 1 (mailbox list grounded)
- `grep -Eci "confirm" docs/operator-runbook.md` → ≥ 1 and `grep -Eci "undo" docs/operator-runbook.md` → ≥ 1
- `grep -c "ADR-004" docs/operator-runbook.md` → ≥ 1 (mail-stack ownership cited)
- `grep -Eci "TODO|FIXME|placeholder|coming soon" docs/operator-runbook.md` → 0

**Context:** Read @.planning/decisions/ADR-003-enforced-confirm-undo.md, @.planning/decisions/ADR-004-mail-stack.md, @src/lib/mailboxes.ts, @vercel.json, and @src/lib/mail/accounts.ts before writing.

## Task 3 — Write the env-var reference, sync .env.example, and the ADR index
**Wave:** 1
**Persona:** none
**Files:** `docs/env-reference.md` (new), `.env.example` (update — currently stale, missing 7 vars), `docs/architecture.md` (new — the ADR index)
**Depends on:** none

**Why:** REQ-19 success criteria 3 and 4 — every env var must be documented (purpose, source, required/optional) with no undocumented variable, and there must be an ADR index linking ADR-001..004 with one-line summaries. The authoritative env contract is `src/lib/env.ts`, which defines 16 variables across 8 Zod schemas; `.env.example` documents only 9 of them and is missing `CRON_SECRET`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_FALLBACK_MODELS`, `TAVILY_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` (confirmed: `grep -E "CRON_SECRET|GOOGLE_API_KEY|TAVILY" .env.example` returns nothing).

**Acceptance Criteria:**
- `docs/env-reference.md` documents EVERY variable the app reads, each with: name, purpose, where the value comes from, and required-vs-optional. The complete set, grounded in `src/lib/env.ts` plus direct `process.env` reads:
  - `APP_BASE_URL` (required — OAuth redirect base, `env.ts:25`)
  - `OPENROUTER_API_KEY` (required for chat, `env.ts:37`), `OPENROUTER_MODEL` (optional, default `google/gemini-3.5-flash`, `env.ts:38`), `OPENROUTER_FALLBACK_MODELS` (optional, comma-separated, `client.ts:247`)
  - `GOOGLE_API_KEY` (required for embeddings + optional direct-Gemini chat path, `env.ts:135`, `client.ts:223`), `GEMINI_MODEL` (optional, default `gemini-3.5-flash`, `client.ts:228`)
  - `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (required for OneDrive, `env.ts:47-48`), `MICROSOFT_TENANT_ID` (optional default `common`, `env.ts:49`), `MICROSOFT_SCOPES` (optional default present, `env.ts:50`)
  - `NEXT_PUBLIC_SUPABASE_URL` (required, `env.ts:59`), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`.env.example:26`), `SUPABASE_SERVICE_ROLE_KEY` (required, server-only, NEVER client-side, `env.ts:60`)
  - `SESSION_SECRET` (required, ≥32 chars, `env.ts:71`), `OPERATOR_CREDENTIALS` (required, JSON principal→scrypt hash map, `env.ts:72`)
  - `ENCRYPTION_KEY` (required, 32-byte base64 AES-256-GCM key, `env.ts:109`)
  - `TAVILY_API_KEY` (required for web search, `env.ts:97`)
  - `EMBEDDING_MODEL` (optional default `gemini-embedding-001`, `env.ts:136`), `EMBEDDING_DIM` (optional default 768, must match `vector(768)` column, `env.ts:137`)
  - `CRON_SECRET` (required in prod — bearer token guarding the cron endpoints, `scheduled/run/route.ts:16`, `memory/sweep/route.ts:33`)
  - Each secret variable explicitly flagged server-only.
- The reference states that mailbox IMAP/SMTP passwords are NOT environment variables — they are stored encrypted in the Supabase `mail_accounts` table (`src/lib/mail/accounts.ts:13,98`) — so a reader doesn't go hunting for `IMAP_PASSWORD`.
- `.env.example` is updated to include every variable above (with the same commented guidance style it already uses), so `cp .env.example .env.local` yields a complete template. No secret values are filled in.
- `docs/architecture.md` is an ADR index: one row/entry per ADR with a one-line summary and a relative link — ADR-001 (Access-Control Strategy), ADR-002 (Durable Memory Architecture), ADR-003 (Enforced Confirm/Undo on Destructive Actions), ADR-004 (Keep Both Mail Stacks, One Owner Per Operation). Titles taken verbatim from each file's `# ADR-00N` heading.
- No "TODO"/"FIXME"/"placeholder" text remains.

**Action:** Create `docs/env-reference.md` as a table (Variable | Required | Server-only | Source/Default | Purpose). Derive the variable set by reading `src/lib/env.ts` and the three direct `process.env` reads (`CRON_SECRET`, `GEMINI_MODEL`, `OPENROUTER_FALLBACK_MODELS`) — do not rely on `.env.example`, which is incomplete. Then update `.env.example` to add the 7 missing variables under appropriately-headed sections, matching the existing comment style (`.env.example:1-44`). Then create `docs/architecture.md` listing the four ADRs with verbatim titles (run `head -1` on each `.planning/decisions/ADR-00*.md`) and one-line summaries, each linking to `../.planning/decisions/ADR-00N-*.md`.

**Validation:** (builder self-check)
- `grep -c "CRON_SECRET" docs/env-reference.md` → ≥ 1 and `grep -c "ENCRYPTION_KEY" docs/env-reference.md` → ≥ 1 and `grep -c "OPERATOR_CREDENTIALS" docs/env-reference.md` → ≥ 1
- `grep -c "CRON_SECRET" .env.example` → ≥ 1 and `grep -c "TAVILY_API_KEY" .env.example` → ≥ 1 (stale example synced)
- `grep -c "ADR-004" docs/architecture.md` → ≥ 1 (all four ADRs indexed)
- `grep -Eci "TODO|FIXME|placeholder|coming soon" docs/env-reference.md docs/architecture.md` → 0

**Context:** Read @src/lib/env.ts (authoritative env contract), @.env.example (to update in place), @src/lib/mail/accounts.ts (mailbox-password storage), and the four @.planning/decisions/ADR-001-access-control-strategy.md @.planning/decisions/ADR-002-durable-memory-architecture.md @.planning/decisions/ADR-003-enforced-confirm-undo.md @.planning/decisions/ADR-004-mail-stack.md headings.

## Success Criteria
- [ ] `README.md` accurately describes Aquavoy as the full agent app (chat + 4 pages), gives a working local-dev path (`npm install` → env → `npm run dev`), maps the real routes, and links to the runbook, env reference, and ADR index — no OneDrive-only framing, no invented routes.
- [ ] `docs/operator-runbook.md` lets an operator drive the chat, understand confirm/undo (the gated destructive set per ADR-003), manage the 12 named mailboxes (IMAP-authoritative per ADR-004), use the OneDrive OAuth connection, and understand the scheduled-email cron.
- [ ] `docs/env-reference.md` documents every one of the ~19 variables (16 in `env.ts` + `CRON_SECRET`, `GEMINI_MODEL`, `OPENROUTER_FALLBACK_MODELS`) with required/optional + source, notes secrets are server-only, and clarifies mailbox passwords live in Supabase — and `.env.example` is synced to match.
- [ ] `docs/architecture.md` is an ADR index linking ADR-001..004 with one-line summaries and verbatim titles.
- [ ] No "TODO"/"FIXME"/"placeholder" text remains in any doc produced this phase.

## Verification Contract

### Contract for Task 1 — README.md exists
**Check type:** file-exists
**Command:** `test -f README.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — README describes the chat surface
**Check type:** grep-match
**Command:** `grep -ci "chat" README.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — README still OneDrive-only, never mentions the agent chat

### Contract for Task 1 — README links the runbook and gives the dev command
**Check type:** grep-match
**Command:** `grep -c "docs/operator-runbook.md" README.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — README does not point readers to the operator runbook

### Contract for Task 1 — no placeholder text in README
**Check type:** command-exit
**Command:** (grep -Eqi for TODO/FIXME/placeholder; exit 1 if found)
**Expected:** exit 1 (no match)
**Fail if:** Any TODO/FIXME/placeholder text remains

### Contract for Task 2 — operator runbook exists
**Check type:** file-exists
**Command:** `test -f docs/operator-runbook.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 2 — runbook lists the real mailboxes and confirm/undo
**Check type:** grep-match
**Command:** `grep -c "prideoffaial@faialbv.com" docs/operator-runbook.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — mailbox list is invented or missing, not grounded in mailboxes.ts

### Contract for Task 2 — runbook cites the mail-stack ownership decision
**Check type:** grep-match
**Command:** `grep -c "ADR-004" docs/operator-runbook.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — IMAP-authoritative ownership not explained

### Contract for Task 3 — env reference exists
**Check type:** file-exists
**Command:** `test -f docs/env-reference.md && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 3 — env reference covers the secrets that are easy to miss
**Check type:** grep-match
**Command:** `grep -c "CRON_SECRET" docs/env-reference.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — CRON_SECRET (a prod-required var absent from .env.example) is undocumented

### Contract for Task 3 — .env.example synced to include the missing vars
**Check type:** grep-match
**Command:** `grep -c "TAVILY_API_KEY" .env.example`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — .env.example still missing variables the app reads

### Contract for Task 3 — ADR index links all four ADRs
**Check type:** grep-match
**Command:** `grep -c "ADR-004" docs/architecture.md`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — ADR index incomplete

### Contract for Task 3 — no placeholder text in env/arch docs
**Check type:** command-exit
**Command:** (grep -Eqi for TODO/FIXME/placeholder across both docs; exit 1 if found)
**Expected:** exit 1 (no match)
**Fail if:** Any TODO/FIXME/placeholder text remains
