# ROADMAP — Aquavoy · Milestone 1: Trust & Hardening

> Current milestone's phase detail. Proposed — pending approval. M2–M4 sketched in JOURNEY.md.

## Phase 1 — Access Control

**Goal:** no one but the real operators can drive the agent or read company data.

**Success criteria:**
- App entry requires a real credential check (not the current loading splash that auto-logs in as "Wency").
- Every API route except the cron runner rejects unauthenticated requests: `chat`, `chat/history`, `mail/*`, `outlook/*`, `onedrive/*` (write paths at minimum), `recipients`.
- The authenticated session establishes the principal server-side; the `principal` query param is no longer trusted as identity.
- One principal cannot read another principal's chat history.

**Notes / approach options (decide in `/qualia-scope` or `/qualia-plan 1`):**
- Lightest: Vercel deployment protection + a shared app password → server-set session cookie that carries the principal. Fits single-tenant, two-operator reality.
- Fuller: Supabase Auth with two seeded users + per-principal RLS policies (the path the migration comments anticipate). Heavier but enables real per-user isolation.

## Phase 2 — Credentials at Rest

**Goal:** no plaintext secrets in Postgres.

**Success criteria:**
- Mailbox passwords (`mail_accounts.password`) stored encrypted; decrypted only server-side at SMTP/IMAP use.
- OAuth `access_token`/`refresh_token` (`onedrive_connections`) stored encrypted.
- Encryption key sourced from env (not committed); a documented rotation path.
- Public accessors still never return secrets (preserve current `MailAccount` vs `MailAccountWithSecret` split).

## Phase 3 — Migration Integrity + Test Safety Net

**Goal:** the repo matches the live DB, and the seams are protected by tests.

**Success criteria:**
- A tracked `supabase/migrations/0007_scheduled_emails.sql` (or correct number) exists and matches the live `scheduled_emails` table; `npx supabase db diff` is clean.
- `mail_accounts` has one authoritative email-uniqueness constraint.
- Test framework (vitest) configured with an `npm test` script.
- Seam tests: Graph transport + OneDrive ops (mocked), IMAP read, SMTP send, scheduled `runDue()` batch, and route-level tests for agent tool dispatch + the new auth guard.
- `npm test` green; `npx tsc --noEmit` clean.

---

**Next:** `/qualia-scope 1` to grill the Phase 1 approach (auth strategy is a real fork worth an ADR), then `/qualia-plan 1`.
