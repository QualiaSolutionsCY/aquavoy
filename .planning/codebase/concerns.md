# Aquavoy — Codebase Quality Concerns

> Read-only quality scan. DOCUMENTS concerns only — nothing was changed.
> Date: 2026-06-15 · Scope: `src/`, `supabase/` · Severity per Qualia rubric (CRITICAL/HIGH/MEDIUM/LOW).

## Context (app model)

Aquavoy is a **single-tenant, ungated** internal tool for Aquavoy Shipping Ltd. There is **no end-user authentication** — `src/app/page.tsx:295-300` auto-logs in as the hardcoded principal "Wency" on mount (`pick("Wency")`), and `src/app/layout.tsx` has no auth wrapper or middleware. There is no `middleware.ts`. The "gate" is only a loading splash, not a credential check. Identity is a free `principal` query param (`Wency`/`Jeanette`) with no verification. This framing matters: most findings below are HIGH rather than CRITICAL *because* the app is assumed to live behind some external access control (Vercel deployment URL obscurity / network boundary) — but that assumption is undocumented and unenforced.

The migration comments themselves acknowledge the gap: `supabase/migrations/0002_recipients.sql:1-3` — *"with no app-auth layer yet we keep it service-role only … When app auth lands, add an owner_id + a policy on auth.uid()."*

---

## CRITICAL

None confirmed. The two findings that approach CRITICAL (unauthenticated mutating API surface, plaintext mailbox passwords) are scored HIGH because the app is single-tenant with no multi-user data-isolation requirement and tokens/passwords live in a service-role-only table (no client-side service_role exposure was found). See HIGH-1 / HIGH-2.

`service_role` key usage is correct and server-only:
- `src/lib/supabase/server.ts:12-18` — `supabaseAdmin()` uses `SUPABASE_SERVICE_ROLE_KEY`, documented "server-only … never imported into a client component."
- `src/lib/env.ts:6-10` — env module documented server-only; no `NEXT_PUBLIC_` prefix on the service-role key.
- Grep for `process.env` in client components (`src/app/page.tsx`, `emails/`, `files/`, `prep/`, `components/`) returned **nothing** — no secret leaks into the browser bundle.
- No `dangerouslySetInnerHTML`, no `eval(` anywhere in `src/`.

---

## HIGH

### HIGH-1 — Mutating + data-reading API routes have NO authorization
Every API route except the cron runner is callable by anyone who can reach the URL. There is no auth header, cookie session, or principal verification on:
- `src/app/api/chat/route.ts:18` — `POST /api/chat`. This is the most serious: the chat agent has tools that **send email, delete/move/rename OneDrive files, read mailboxes**. See tool list in `src/lib/agents/onedriveTools.ts:254` (`send_email`), `:187` (`delete_item`), `:141` (`move_item`), `:164` (`rename_item`), `:388` (`read_email`), `:416` (`search_emails`). An unauthenticated caller can drive any of these.
- `src/app/api/outlook/send/route.ts:15` — `POST` sends/drafts mail with no auth.
- `src/app/api/mail/send/route.ts` — SMTP send, no auth.
- `src/app/api/onedrive/upload/route.ts`, `download/route.ts`, `item/route.ts`, `folder/route.ts`, `search/route.ts`, `files/route.ts` — full OneDrive read/write surface, no auth.
- `src/app/api/recipients/route.ts`, `src/app/api/chat/history/route.ts` — read/write PII (recipient names/emails, full chat history) by `principal` query param with no verification; one principal can read another's history by changing the param.

Contrast: `src/app/api/mail/scheduled/run/route.ts:15-20` is the *only* protected route (bearer `CRON_SECRET`). The pattern exists; it just isn't applied to user-facing routes.
Rubric match: HIGH — "missing auth on user-facing path / wiring missing." Not CRITICAL only because the app is single-tenant and presumed network-gated.

### HIGH-2 — Mailbox passwords stored in plaintext
`supabase/migrations/0003_mail_accounts.sql:14` — `password text not null`; comment at `:1-3` confirms "Holds plaintext passwords." `src/lib/mail/accounts.ts:62,92` read/write the raw password. Mitigations present: RLS-on/no-policy locks the table to service-role (`0003:25`), and the public accessor never returns the password (`accounts.ts:14,104`). Still, at-rest plaintext credentials for live company mailboxes is a HIGH exposure if the service-role key or a DB backup leaks.
OAuth tokens have the same shape (`0001_onedrive_connections.sql:15-16` — `access_token`/`refresh_token` plaintext) — same RLS mitigation, same residual risk.

### HIGH-3 — No tests of any kind
No `*.test.ts`/`*.spec.ts`/`__tests__` exist anywhere. `package.json` has no `test` script and no test framework (jest/vitest/playwright) in devDependencies. Per the Qualia architecture rules, the seam-level tests (adapter mocks for Graph/SMTP/IMAP, route-level for the agent tool dispatch) are exactly the ones that would survive refactors here — and there are zero. Any change to the OAuth refresh logic (`src/lib/microsoft/oauth.ts`) or agent tool routing (`onedriveTools.ts`) ships unverified.

---

## MEDIUM

### MED-1 — `principal` is a trust boundary but only validated for shape, not identity
`src/app/api/chat/route.ts:28-31` whitelists `identity` against `PRINCIPAL_SET` (good — prevents prompt injection of arbitrary identity), but there is no proof the caller *is* that principal. `chat/history/route.ts` keys reads/writes purely on the `principal` query param (`:105`, `:135`). With two principals (Wency/Jeanette) sharing the same unauthenticated app, either can read the other's stored conversations. Rubric: MEDIUM (hardcoded/weak access control within a closed app).

### MED-2 — `onedrive/connect` route bypasses the shared error wrapper
`src/app/api/onedrive/connect/route.ts` is the only route that uses neither `handle()` nor a `try/catch`. A thrown error (e.g. missing Microsoft env) becomes an unhandled 500 with a raw stack rather than the uniform `{ ok:false, error }` envelope every other route returns via `src/lib/http.ts:19-30`. Inconsistent error surface; low blast radius.
(Note: routes without a literal `try {` are NOT all unguarded — most wrap their body in `handle()` from `http.ts`, which catches and normalizes. Only `connect` does neither.)

### MED-3 — Mail-account email uniqueness fixed reactively, two overlapping constraints
`supabase/migrations/0005_fix_mail_accounts_on_conflict.sql` adds a plain `unique (email)` because the `lower(email)` expression index in `0003` didn't satisfy the upsert's `ON CONFLICT (email)`. Result is two unique constraints on the same column (plain + `lower()`), with a comment relying on the UI always lowercasing input. If a future caller upserts a mixed-case email, the two constraints can disagree. MEDIUM — works today, fragile to a new write path.

---

## LOW

### LOW-1 — Two `console.warn` left in a client component
`src/app/page.tsx:201` — `console.warn("chat-history persist failed", e)` and `:211` — `console.warn("chat-history clear failed", e)`. Both are deliberate soft-fail logs on enhancement paths, not stray debug noise, but they surface in the browser console in production. LOW.

### LOW-2 — `set_updated_at()` trigger function redefined in 3 migrations
`0001`, `0002`, `0003` each `create or replace function public.set_updated_at()` with identical bodies, each justified by a "independently runnable" comment. Harmless (CREATE OR REPLACE is idempotent) but is duplicated migration logic. LOW.

---

## What was checked and found CLEAN

- **TODO/FIXME/HACK/XXX:** zero matches in `src/` (the only `placeholder` hits are legitimate HTML input `placeholder=` attributes).
- **Stubs / not-implemented:** none.
- **service_role client-side exposure:** none (see CRITICAL section).
- **`dangerouslySetInnerHTML` / `eval`:** none.
- **RLS enabled:** YES on every table (`onedrive_connections`, `mail_accounts`, `recipients`, `chat_messages`) — all use the intentional "RLS on, zero policies → service-role-only" lockdown pattern. This *satisfies* the constitution's "RLS on every table" since there is no `authenticated`/`anon` access path; it does NOT provide per-user isolation (by design, given no app auth — see MED-1).
- **OAuth flow:** state cookie CSRF protection present (`src/app/api/onedrive/connect/route.ts:16`, validated at `callback/route.ts:26`); refresh-token rolling handled (`oauth.ts:88-92`); confidential-client secret server-only.
- **Error handling:** centralized via `handle()` in `src/lib/http.ts` (used by all routes except `connect` — MED-2) and explicit try/catch in `chat/route.ts` and `scheduled/run/route.ts`.

---

## Summary

**Counts — CRITICAL: 0 · HIGH: 3 · MEDIUM: 3 · LOW: 2.** The codebase is clean on the usual smells: no TODOs/stubs, no client-side service_role leak, no `eval`/`dangerouslySetInnerHTML`, RLS enabled on all four tables, centralized error handling, and a correct CSRF-protected OAuth flow. The dominant theme is the **absence of an app-auth layer** in an app whose unauthenticated `/api/chat` endpoint can send email and delete/move OneDrive files (HIGH-1), compounded by plaintext mailbox passwords / OAuth tokens at rest (HIGH-2, mitigated by service-role-only RLS) and a total lack of tests (HIGH-3). These are acceptable only under an undocumented assumption that the deployment is network-gated; that assumption should be made explicit (e.g. Vercel deployment protection) or replaced with real auth + per-principal RLS policies as the migration comments themselves anticipate.
