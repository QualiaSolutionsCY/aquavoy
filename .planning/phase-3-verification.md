# Phase 3 — Migration Integrity + Test Safety Net · Verification

**Verdict: PASS**
**Date:** 2026-06-15 · Branch `m1-trust-hardening` · Commits b8f92f6, 78eb2cb, 2238a3e
**Method:** contract-runner.js → 11/11 checks PASS (incl. live `npx vitest run` + `tsc --noEmit`), evidence at `.planning/evidence/phase-3-contract-run.json`.

## Contract results (11/11 PASS)

| Contract | Result |
|---|---|
| T1 0007_scheduled_emails.sql exists | PASS |
| T1 all 10 columns present | PASS |
| T1 status check + RLS lockdown | PASS |
| T2 0008 drops redundant lower(email) index | PASS |
| T2 no new constraint added | PASS |
| T3 vitest test script wired | PASS |
| T3 vitest.config.ts exists | PASS |
| T3 all seam/crypto test files exist | PASS |
| T3 suite green (`vitest run`) | PASS — 8 files / 30 tests |
| T3 typecheck clean | PASS (0) |
| T3 runDue per-row isolation asserted | PASS |

## Goal-level assessment

**Goal:** Repo migrations match the live DB; the seams are protected by tests.

- **REQ-6:** `0007_scheduled_emails.sql` now tracks the previously out-of-band table — full column set from `ScheduledRow`, four-value status check, RLS-on/no-policy, idempotent. Schema-match self-check passed (no local Supabase stack reachable for `db diff`; column superset verified against `scheduled.ts`). ✓
- **REQ-7:** `0008` drops the redundant `lower(email)` expression index, leaving the plain `unique(email)` (`mail_accounts_email_key`) as the sole authoritative rule the `onConflict:"email"` upsert needs; case-insensitivity preserved by app-layer lowercasing. ✓
- **REQ-8:** vitest configured; 30 tests across 8 files cover Graph transport, OneDrive mapping, IMAP read, SMTP send, `runDue()` per-row isolation, the Phase-2 encryption round-trip, the Phase-1 session sign/verify, and agent `executeTool` dispatch (success / validation-error / unknown-tool-no-throw). All vendors mocked — no live endpoints. ✓

## Deviations (minor, accepted)

- `vi.mock` factories declared via `vi.hoisted(...)` (required by vitest 4 hoisting). Same behavior.
- vitest resolved to 4.1.9 (within the `^4.1.7` range).
- REQ-6 `db diff` was a schema-match self-check rather than a live diff (no local Supabase stack in the build env) — the success criterion explicitly allows this. Recommend a live `npx supabase db diff` during `/qualia-ship`.

## Gaps

None blocking.
