# Phase 2 — Credentials at Rest · Verification

**Verdict: PASS**
**Date:** 2026-06-15 · Branch `m1-trust-hardening` · Commits 3fb0fa6, 8e97883, 1e519ea
**Method:** contract-runner.js → 11/11 checks PASS, evidence at `.planning/evidence/phase-2-contract-run.json`.

## Contract results (11/11 PASS)

| Contract | Result |
|---|---|
| T1 crypto util exists | PASS |
| T1 Node built-in AES-256-GCM (no new dep) | PASS |
| T1 exports encryptSecret/decryptSecret/isEncrypted | PASS (3) |
| T1 env ENCRYPTION_KEY/getCryptoEnv accessor | PASS |
| T1 no crypto npm package added | PASS |
| T2 mail password encrypted on write | PASS |
| T2 mail password decrypted on read | PASS |
| T2 no plaintext password pass-through | PASS |
| T3 OAuth tokens encrypted on write (4 sites) | PASS |
| T3 OAuth tokens decrypted on read (2 sites) | PASS |
| T3 refresh token decrypted before use; no plaintext token write | PASS |
| Typecheck clean | PASS (0) |

## Goal-level assessment

**Goal:** No plaintext secrets in Postgres.

- **REQ-4:** `mail_accounts.password` written via `encryptSecret`, read via `decryptSecret` in `toMailAccountWithSecret` only; public `MailAccount`/`listAccounts` remain secret-free. ✓
- **REQ-5:** `onedrive_connections.access_token`/`refresh_token` encrypted at all 4 write sites; `getValidAccessToken` decrypts the fresh token and the refresh-token argument so Microsoft's endpoint receives the real value; `listConnections` exposes no tokens. ✓
- **Self-healing backfill:** `decryptSecret` tolerantly returns legacy plaintext unchanged; the next save/refresh re-encrypts — no broken rows, no separate migration script. ✓
- **No new dependency:** Node `node:crypto` AES-256-GCM. ✓

## Operational prerequisite

`ENCRYPTION_KEY` (32-byte base64, e.g. `openssl rand -base64 32`) must be set in `.env.local` and Vercel before deploy. Documented in `secrets.ts` header.
