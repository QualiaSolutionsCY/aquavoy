# Credential & Ownership Handover — Aquavoy

**Client:** Wence — Aquavoy Shipping Ltd / Faial BV
**Built by:** Qualia Solutions

## What this document is

This is a **prepared handover artifact**. It lists the accounts, keys, and access that
make up the Aquavoy deployment, plus the acceptance and access-removal steps that close
the engagement.

The actual transfer of credentials, the acceptance sign-off, and the removal of Qualia
access are **performed by humans during the handover ceremony**. Nothing in this document
is recorded as done. Every checkbox below is intentionally left **unchecked**, and the
signature block is intentionally left **blank**. Check a box only after the verify step
beside it has actually been observed; sign only after acceptance is genuinely agreed.

> **Mailbox passwords are not environment variables.** The 12 IMAP/SMTP company mailbox
> credentials (aquavoy.com / faialbv.com) live **encrypted at rest in Supabase**
> (`mail_accounts` table, encrypted with `ENCRYPTION_KEY` via `src/lib/crypto/secrets.ts`)
> and are managed through the in-app **/emails** page — they are not handed over as env
> vars. They transfer automatically with Supabase project ownership; re-enter or rotate
> them via /emails if the encryption key is rotated. See `docs/env-reference.md`.

---

## 1. Credential & ownership handover

Each row: the account/key, what to transfer, and a one-line verify step. Leave unchecked
until the verify step is observed.

### Platforms / accounts

- [ ] **Supabase project** — Transfer project ownership (database, `mail_accounts`,
  migrations, storage) to the client's Supabase organization.
  *Verify:* client logs into the Supabase dashboard and sees the Aquavoy project under
  their own organization.
- [ ] **Vercel project** — Transfer the Vercel project (hosting, cron, env vars) to the
  client's Vercel team.
  *Verify:* client logs into Vercel and sees the Aquavoy project under their team. (Deploy
  access is detailed in §2.)
- [ ] **Microsoft (Azure) app registration** — Transfer ownership of the Azure app
  registration used for OneDrive / Outlook delegated OAuth to the client's Azure AD.
  *Verify:* client opens Azure Portal → App registrations and sees the Aquavoy app under
  their tenant as an owner.
- [ ] **Source repository** — Transfer GitHub repository ownership/admin to the client's
  GitHub account or organization.
  *Verify:* client opens the repo on GitHub and confirms admin (Settings) access.

### Supabase keys

- [ ] **`NEXT_PUBLIC_SUPABASE_URL`** — Hand over the project URL (or it transfers with
  Supabase project ownership above). Client-safe value.
  *Verify:* value present in the client's Vercel env and matches the project URL shown in
  their Supabase dashboard.
- [ ] **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** — Hand over the publishable (anon) key.
  Client-safe value.
  *Verify:* value present in the client's Vercel env and matches the publishable key in
  their Supabase dashboard (Project Settings → API).
- [ ] **`SUPABASE_SERVICE_ROLE_KEY`** — Hand over the service-role key. **Server-only —
  never client, never `NEXT_PUBLIC_`.** Rotate it after handover so Qualia's copy is void.
  *Verify:* a rotated service-role key is set in the client's Vercel env and a server
  request (e.g. loading /emails) succeeds with it.

### Microsoft Graph / OneDrive OAuth

- [ ] **`MICROSOFT_CLIENT_ID`** — Hand over the Azure app registration client id.
  *Verify:* matches the Application (client) ID shown in the client's Azure app
  registration.
- [ ] **`MICROSOFT_CLIENT_SECRET`** — Hand over (or have the client mint a fresh) client
  secret. **Server-only.** Prefer minting a new secret in the client's tenant and revoking
  the old one.
  *Verify:* OneDrive connect flow completes an OAuth round-trip with the secret set in the
  client's env.
- [ ] **`MICROSOFT_TENANT_ID`** — Hand over the tenant value (`common`, `organizations`,
  `consumers`, or tenant GUID).
  *Verify:* value matches the client's intended Azure tenant.

### AI & web service keys (server-only)

- [ ] **`OPENROUTER_API_KEY`** — Transfer or have the client provision their own
  OpenRouter key; update Vercel env. Powers all conversational LLM calls.
  *Verify:* a chat message in the app returns a streamed reply using the client's key.
- [ ] **`GOOGLE_API_KEY`** — Transfer or re-provision the Google API key (durable-memory
  embeddings + direct Gemini path).
  *Verify:* a request that triggers memory recall / embeddings succeeds with the client's
  key.
- [ ] **`TAVILY_API_KEY`** — Transfer or re-provision the Tavily web-search key.
  *Verify:* a web-research query in chat returns results with the client's key.

### App secrets (server-only — rotate on handover)

- [ ] **`SESSION_SECRET`** — Hand over or regenerate the HMAC key signing the operator
  session cookie (`openssl rand -base64 48`, min 32 chars).
  *Verify:* operators can log in and stay signed in after the value is set in the client's
  env.
- [ ] **`ENCRYPTION_KEY`** — Hand over the AES-256-GCM master key that decrypts mailbox
  passwords and OAuth tokens at rest (32-byte base64). **Do not rotate without re-entering
  mailbox credentials and re-connecting OneDrive — encrypted data is unrecoverable if the
  key is lost.**
  *Verify:* after the key is set in the client's env, /emails loads existing mailboxes and
  a test send/receive works (proves decryption succeeds).
- [ ] **`OPERATOR_CREDENTIALS`** — Hand over the JSON map of `principal → "saltHex:hashHex"`
  scrypt hashes (principals: Wency, Jeanette). Plaintext passwords are never stored; reset
  by regenerating hashes if needed.
  *Verify:* both named operators can log in with their credentials.
- [ ] **`CRON_SECRET`** — Hand over or regenerate the bearer token guarding the cron
  endpoints (`/api/mail/scheduled/run`, `/api/memory/sweep`). Set in the client's Vercel
  env.
  *Verify:* the per-minute cron run returns 200 (not 401) in Vercel cron logs after the
  value is set.

> Full per-variable detail (required/optional, server-only flags, defaults) lives in
> `docs/env-reference.md`. Keep `.env.example` as the canonical template.

---

## 2. Independent Vercel deploy access

So the client can deploy without Qualia. Leave unchecked until observed.

- [ ] **Project ownership/membership** — Add the client's Vercel account as an Owner (or
  transfer the project into the client's Vercel team).
  *Verify:* client sees the Aquavoy project in their own Vercel team.
- [ ] **Connect the client's Git** — Connect the transferred GitHub repository to the
  client's Vercel project (or confirm CLI deploys).
  *Verify:* the project's Git settings show the client-owned repository.
- [ ] **Env vars present on the client's side** — Ensure every variable from §1 is set in
  the client's Vercel project environment.
  *Verify:* `vercel env ls` (run by the client) lists all required variables.
- [ ] **Client performs a deploy** — Client triggers a production deploy themselves
  (`vercel --prod` or via their Git integration).
  *Verify:* a deploy initiated by a client-owned account reaches Ready and the homepage
  loads.

---

## 3. Acceptance sign-off

Acceptance ties to the milestone exit criteria delivered across the engagement. Confirm
each was met, then sign. **Do not sign on Qualia's behalf — the client signs.**

### Milestone exit criteria

- **M1 — Trust:** authentication gate on the powerful API surface; credentials and OAuth
  tokens encrypted at rest (`ENCRYPTION_KEY` / `src/lib/crypto/secrets.ts`); database
  schema captured as migrations with a seam-level test safety net (migration drift
  resolved).
- **M2 — Agent Depth:** durable conversation memory (auto-injected per request + callable
  `recall_memory`); inline document understanding (Word/PDF/Excel extraction); and
  confirm-before-act / undo guardrails on send/schedule/delete.
- **M3 — Operations Polish:** observability traces across the agent loop; the mail-stack
  decision recorded (ADR-004); and UX states (loading/error/empty) plus a working 375px
  mobile layout.

- [ ] Client confirms **M1 — Trust** exit criteria are met.
- [ ] Client confirms **M2 — Agent Depth** exit criteria are met.
- [ ] Client confirms **M3 — Operations Polish** exit criteria are met.

### Signature block

Sign only when acceptance is genuinely agreed. Left blank deliberately.

```
Name: ________________________________

Role: ________________________________

Date: ________________________________

Signature: ____________________________
```

---

## 4. Post-handover: Qualia access removal

Performed **after** §1–§3 are complete and verified. Removing Qualia access too early
breaks the transfer; too late leaves standing access. Leave unchecked until each removal
is actually done.

- [ ] **Supabase** — Remove Qualia developer accounts from the client's Supabase
  organization; confirm no Qualia member retains project access.
  *Verify:* client's Supabase org member list shows no Qualia accounts.
- [ ] **Vercel** — Remove Qualia accounts from the client's Vercel team/project.
  *Verify:* client's Vercel team member list shows no Qualia accounts.
- [ ] **Microsoft (Azure)** — Remove Qualia as an owner of the app registration; mint a
  fresh client secret under the client's control and revoke any secret Qualia held.
  *Verify:* the app registration owners list shows no Qualia accounts and the old secret is
  revoked.
- [ ] **Source repository** — Remove Qualia collaborators/admins from the client's GitHub
  repository.
  *Verify:* the repo's access settings show no Qualia accounts.
- [ ] **Secret rotation confirmed** — Confirm server-only secrets handled by Qualia
  (`SUPABASE_SERVICE_ROLE_KEY`, `MICROSOFT_CLIENT_SECRET`, `OPENROUTER_API_KEY`,
  `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `SESSION_SECRET`, `OPERATOR_CREDENTIALS`,
  `CRON_SECRET`) were rotated where feasible so Qualia-held copies are void. (`ENCRYPTION_KEY`
  rotation requires re-entering mailbox credentials and reconnecting OneDrive — coordinate
  before rotating.)
  *Verify:* the app still functions on the client's rotated secrets and prior values no
  longer authenticate.
