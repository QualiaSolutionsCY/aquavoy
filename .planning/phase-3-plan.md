---
phase: 3
goal: "The repo's migrations match the live DB, and the seams are protected by tests."
tasks: 3
waves: 1
---

# Phase 3: Migration Integrity + Test Safety Net

**Goal:** The repo's `supabase/migrations/` matches the live Postgres schema (the untracked `scheduled_emails` table is now a tracked migration; `mail_accounts` has one authoritative email-uniqueness rule), and the external seams (Graph/IMAP/SMTP), the scheduled-email runner, the Phase-2 encryption util, and the Phase-1 auth guard + agent tool dispatch are covered by vitest seam/route tests.

**Why this phase:** Phases 1 and 2 added auth and encryption to a codebase with zero tests and a migration that exists in the live DB but not on disk. Without a tracked `0007_scheduled_emails.sql` the schema can't be rebuilt or branched; without tests the new auth guard and encryption round-trip ship unverified. This phase makes the repo reproducible and the seams refactor-safe.

> **Phase-1/Phase-2 artifact note (read before T3).** This phase runs AFTER Phase 1 (auth) and Phase 2 (encryption). Per `.planning/decisions/ADR-001-access-control-strategy.md:29`, Phase 1 creates **`src/proxy.ts`** (Next.js 16 renamed `middleware.ts` → `proxy.ts`; ADR substance unchanged — do NOT look for `src/middleware.ts`), `POST /api/login`, and a session-signing util (HMAC over `SESSION_SECRET`). ADR-001 does NOT pin the session util's filename. The Phase-2 plan (verified PASS) creates the encryption util at **`src/lib/crypto/secrets.ts`** exporting **`encryptSecret()`** / **`decryptSecret()`** (AES-GCM) and reads an encryption-key env var. **Treat `src/lib/crypto/secrets.ts` + `encryptSecret`/`decryptSecret` as the confirmed Phase-2 surface; treat the session util path (planner assumption: `src/lib/auth/session.ts`) as UNVERIFIED.** T3's first Action step greps to confirm both shipped as planned and discovers the real exported symbols/paths, then writes tests against what is really there. Do NOT hardcode an import path the grep contradicts.

## Task 1 — Track the `scheduled_emails` migration to match the live table
**Wave:** 1
**Persona:** backend
**Files:** `supabase/migrations/0007_scheduled_emails.sql` (create)
**Depends on:** none

**Why:** `src/lib/mail/scheduled.ts:7` documents the table as living in `0007_scheduled_emails.sql`, but `ls supabase/migrations/` returns only `0001`…`0006` — the table was applied out-of-band and is untracked (codebase map `architecture.md:181`). Without a tracked migration the schema cannot be rebuilt from the repo or branched on Supabase, which is exactly the migration-drift failure REQ-6 closes.

**Acceptance Criteria:**
- `supabase/migrations/0007_scheduled_emails.sql` exists and creates `public.scheduled_emails` with every column `scheduled.ts` reads/writes: `id uuid pk`, `from_email text not null`, `to_email text not null`, `subject text not null`, `body text not null`, `scheduled_at timestamptz not null`, `status text not null default 'pending'`, `sent_at timestamptz`, `error text`, `created_by text`, `created_at timestamptz not null default now()`.
- A `check` constraint restricts `status` to exactly the four values the code uses: `pending`, `sent`, `failed`, `cancelled` (`scheduled.ts:22`).
- RLS is enabled with NO policies (matches the service-role-only lockdown pattern documented in `scheduled.ts:8-9` and used by `0003_mail_accounts.sql:27-28`).
- The migration is idempotent (`create table if not exists`) and self-contained the same way `0003`/`0006` are.

**Action:**
1. Reconstruct the exact column set from `src/lib/mail/scheduled.ts`. The `ScheduledRow` interface (`scheduled.ts:29-41`) is the authoritative shape: snake_case columns `id, from_email, to_email, subject, body, scheduled_at, status, sent_at, error, created_by, created_at`. The insert at `scheduled.ts:85-93` confirms `status` defaults to `'pending'` and `created_by` is nullable. The `runDue` updates (`scheduled.ts:183,191`) write `sent_at` and `error`. The public `ScheduledEmail.status` union (`scheduled.ts:22`) is the source for the check constraint values.
2. Write `create table if not exists public.scheduled_emails (...)` with `id uuid primary key default gen_random_uuid()`. `from_email`, `to_email`, `subject`, `body` are `text not null`. `scheduled_at timestamptz not null`. `status text not null default 'pending'`. `sent_at timestamptz`, `error text`, `created_by text` (nullable — `scheduled.ts:92` inserts `null`). `created_at timestamptz not null default now()`.
3. Add `constraint scheduled_emails_status_check check (status in ('pending','sent','failed','cancelled'))`.
4. Add an index supporting the `runDue` query (`scheduled.ts:153-159` filters `status='pending'` and `scheduled_at <= now()` ordered by `scheduled_at`): `create index if not exists scheduled_emails_due_idx on public.scheduled_emails (status, scheduled_at)`.
5. `alter table public.scheduled_emails enable row level security;` with no policies. Add a `comment on table` noting service-role-only, matching the `0003` style.
6. Verify against the live DB. If a local Supabase stack is available, run `npx supabase db diff` and confirm it reports no difference for `scheduled_emails`. If no local stack is reachable, document that in a top-of-file SQL comment AND verify the migration columns are a superset of every column name appearing in `scheduled.ts` (grep self-check below) — this is the schema-match assertion the success criterion allows.

**Validation:** (builder self-check)
- `test -f supabase/migrations/0007_scheduled_emails.sql && echo EXISTS` → `EXISTS`
- `grep -Eo "(from_email|to_email|subject|body|scheduled_at|status|sent_at|error|created_by|created_at)" supabase/migrations/0007_scheduled_emails.sql | sort -u | wc -l` → `10` (all ten non-id columns present)
- `grep -c "enable row level security" supabase/migrations/0007_scheduled_emails.sql` → `1`
- `grep -c "in ('pending','sent','failed','cancelled')" supabase/migrations/0007_scheduled_emails.sql` → `1`

**Context:** Read @src/lib/mail/scheduled.ts (authoritative table shape), @supabase/migrations/0003_mail_accounts.sql (RLS-on/no-policy + comment style to mirror), @supabase/migrations/0006_chat_sessions.sql (latest migration, for numbering + idempotent style), @.planning/codebase/architecture.md (§7 migration-gap note).

## Task 2 — Reconcile `mail_accounts` to one authoritative email-uniqueness constraint
**Wave:** 1
**Persona:** backend
**Files:** `supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql` (create)
**Depends on:** none

**Why:** `0003_mail_accounts.sql:25` creates a `lower(email)` expression unique index AND `0005_fix_mail_accounts_on_conflict.sql:5-6` adds a plain `unique(email)` constraint — two overlapping uniqueness rules on the same column (codebase map MED-3). They can disagree if a mixed-case email is ever upserted, and the app's upsert relies on `ON CONFLICT (email)` (`accounts.ts:96`) which needs the plain constraint. REQ-7 requires exactly one authoritative rule.

**Acceptance Criteria:**
- A new migration `supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql` drops the redundant `lower(email)` expression index (`mail_accounts_email_unique` from `0003:25`) and keeps the plain `unique(email)` constraint (`mail_accounts_email_key` from `0005:6`) as the single authoritative uniqueness rule — because `accounts.ts:96` upserts with `onConflict: "email"`, which a plain constraint satisfies and an expression index does not.
- Case-insensitive correctness is preserved by application normalization: `saveAccount` already lowercases on write (`accounts.ts:85`) and `scheduleEmail` lowercases too (`scheduled.ts:86-87`); the migration's leading comment documents that the plain `unique(email)` is authoritative and emails are normalized to lowercase in the application layer before insert.
- The migration is idempotent (`drop index if exists`) and runs cleanly whether or not `0003`/`0005` were applied.

**Action:**
1. Confirm both constraints exist by reading `0003_mail_accounts.sql:25` (`create unique index ... mail_accounts_email_unique on public.mail_accounts (lower(email))`) and `0005_fix_mail_accounts_on_conflict.sql:5-6` (`add constraint mail_accounts_email_key unique (email)`).
2. In `0008`, `drop index if exists public.mail_accounts_email_unique;` — removing the expression index, leaving `mail_accounts_email_key` (the plain `unique(email)`) as the lone uniqueness rule.
3. Add a leading SQL comment stating: the plain `unique(email)` constraint (`mail_accounts_email_key`) is authoritative; the redundant `lower(email)` expression index from `0003` is removed; case-insensitivity is guaranteed by application-layer lowercasing at `accounts.ts:85` and `scheduled.ts:86-87` before every write; `loadAccountWithSecretByEmail` reads with `ilike` (`accounts.ts:138`) which stays correct regardless.
4. Do NOT drop or recreate `mail_accounts_email_key` — it is the one being kept. Only the expression index is removed.

**Validation:** (builder self-check)
- `test -f supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql && echo EXISTS` → `EXISTS`
- `grep -c "drop index if exists public.mail_accounts_email_unique" supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql` → `1`
- `grep -c "mail_accounts_email_key" supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql` → at least `1` (referenced in the comment as the kept constraint)
- `! grep -q "add constraint" supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql && echo NO-NEW-CONSTRAINT` → `NO-NEW-CONSTRAINT` (we only drop the index; we don't add anything)

**Context:** Read @supabase/migrations/0003_mail_accounts.sql (the expression index at :25), @supabase/migrations/0005_fix_mail_accounts_on_conflict.sql (the plain constraint at :5-6), @src/lib/mail/accounts.ts (the `onConflict: "email"` upsert at :96, the lowercasing at :85, the `ilike` read at :138).

## Task 3 — Add vitest + seam/route test safety net
**Wave:** 1
**Persona:** architect
**Files:** `package.json` (modify — add devDeps + `test` script), `vitest.config.ts` (create), `vitest.setup.ts` (create), `src/lib/microsoft/graph.test.ts` (create), `src/lib/microsoft/onedrive.test.ts` (create), `src/lib/mail/imap.test.ts` (create), `src/lib/mail/smtp.test.ts` (create), `src/lib/mail/scheduled.test.ts` (create), `src/lib/crypto/secrets.test.ts` (create), `src/lib/auth/session.test.ts` (create — adjust path if step-1 grep finds the session util elsewhere), `src/lib/agents/onedriveTools.test.ts` (create)
**Depends on:** none

**Why:** The codebase has zero tests (codebase map HIGH-3) — any change to OAuth refresh, the agent tool router, or the new Phase-1 auth guard / Phase-2 encryption ships unverified. Per `rules/architecture.md` §6 "test the seam, not the function," seam/adapter/route tests survive refactors; that is what REQ-8 mandates. This also gives Phases 1 and 2 the regression coverage their new code currently lacks.

**Acceptance Criteria:**
- `npm test` runs vitest and exits 0 with all tests passing; `package.json` has a `"test": "vitest run"` script and `vitest` (+ any needed adapter) in `devDependencies`.
- `npx tsc --noEmit` stays clean (test files type-check under strict mode; the `@/` path alias resolves in both tsc and vitest).
- Seam tests exist and pass for: Graph transport (`graph.ts` — `graphJson`/`graphRaw` with `fetch` and `getValidAccessToken` mocked, asserting auth header + `GraphError` on non-2xx), OneDrive ops (`onedrive.ts` — `listChildren`/`getItem` with `graphJson` mocked, asserting the `GraphDriveItem`→`DriveItem` mapping), IMAP read (`imap.ts` — `ImapFlow` + `simpleParser` + `loadAccountWithSecretByEmail` mocked, asserting folder resolution + envelope formatting), SMTP send (`smtp.ts` — `nodemailer.createTransport` mocked, asserting `sendMail` builds the `from` header and calls `transport.sendMail`), scheduled `runDue()` (`scheduled.ts` — `supabaseAdmin`, `loadAccountWithSecretByEmail`, `sendMail` mocked, asserting per-row error isolation: one failing row still flips others to `sent`).
- Phase-2 encryption round-trip test passes: `decryptSecret(encryptSecret(x)) === x` and ciphertext ≠ plaintext (against the real Phase-2 util at `src/lib/crypto/secrets.ts` — confirmed in the artifact note; step-1 grep re-confirms the exports).
- Phase-1 auth-guard test passes at the seam: the session-signing util round-trips a principal (sign → verify returns the principal) and a tampered/invalid token verifies as rejected (against the real Phase-1 util — path/exports discovered at build time per step 1).
- Agent tool-dispatch test passes: `executeTool('send_email', {...})` with `loadAccountWithSecretByEmail` + `sendMail` mocked returns the success JSON `{"sent":true,...}`; `executeTool('send_email', { from:'x', to:'', subject:'', body:'' })` returns the validation-error JSON (`onedriveTools.ts:680-681`); `executeTool('unknown_tool', {})` returns a readable error string and does not throw (`onedriveTools.ts:569` — "Never throws").
- No test hits a real Graph/IMAP/SMTP/Supabase endpoint — all external vendors are mocked.

**Action:**
1. **Discover/confirm the real Phase-1/Phase-2 symbols FIRST.** Run:
   - `ls src/proxy.ts && grep -rln "SESSION_SECRET\|signSession\|verifySession\|createSession\|getPrincipal" src/lib src/app` to locate the session-signing util and its exported function names. **The Phase-1 guard file is `src/proxy.ts`, NOT `src/middleware.ts` (Next.js 16 rename per ADR-001:29).** If the session util is not at `src/lib/auth/session.ts`, write the test against the REAL path/export and name the test file accordingly.
   - `ls src/lib/crypto/secrets.ts && grep -n "export.*encryptSecret\|export.*decryptSecret" src/lib/crypto/secrets.ts` to re-confirm the Phase-2 encryption util shipped as planned (`encryptSecret`/`decryptSecret`). If a prior phase shipped either util under a different design, write the test against the actual entrypoint that exists and note the deviation in `.planning/phase-3-deviations.json`.
2. **Install vitest.** Add to `devDependencies`: `"vitest": "^4.1.7"`. Add script `"test": "vitest run"` (and optionally `"test:watch": "vitest"`). Run `npm install`.
3. **`vitest.config.ts`** (ESM, node env, `@/` alias resolving to `./src`). Vitest natively handles the ESM source; map the alias with an absolute path so it matches tsconfig (`tsconfig.json:25-29`):
   ```ts
   import { defineConfig } from "vitest/config";
   import { fileURLToPath } from "node:url";
   export default defineConfig({
     resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
     test: { environment: "node", globals: true, setupFiles: ["./vitest.setup.ts"], include: ["src/**/*.test.ts"] },
   });
   ```
4. **`vitest.setup.ts`** — set the env vars the modules read at import/use time so tests don't depend on a real `.env`. At minimum stub `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SESSION_SECRET`, and the Phase-2 encryption-key env var (discover its exact name when reading `src/lib/crypto/secrets.ts` in step 1). Use `vi.stubEnv` or assign `process.env.*` before modules load.
5. **Mock external vendors with `vi.mock`** — never hit a network. Patterns per seam:
   - `graph.test.ts`: `vi.stubGlobal("fetch", vi.fn())`; `vi.mock("@/lib/microsoft/connections", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("tok") }))`. Assert `graphJson` sends `Authorization: Bearer tok` and throws `GraphError` with the right `status` on a non-ok response.
   - `onedrive.test.ts`: `vi.mock("@/lib/microsoft/graph", () => ({ graphJson: vi.fn(), graphRaw: vi.fn() }))`. Feed a `GraphDriveItem` fixture into `listChildren`/`getItem` and assert the mapped `DriveItem` fields (`onedrive.ts:22-41`).
   - `imap.test.ts`: `vi.mock("imapflow", ...)` returning a fake `ImapFlow` (connect/list/mailboxOpen/fetch/logout), `vi.mock("mailparser", ...)`, `vi.mock("@/lib/mail/accounts", () => ({ loadAccountWithSecretByEmail: vi.fn() }))`. Assert `listFolders`/`listEmails` map envelopes and that a missing account throws (`imap.ts:45-46`).
   - `smtp.test.ts`: `vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(), verify: vi.fn(), close: vi.fn() })) } }))`. Assert `sendMail` calls `transport.sendMail` with a `from` of `"Name" <email>` (`smtp.ts:66`) and that a thrown send wraps the error (`smtp.ts:74`).
   - `scheduled.test.ts`: `vi.mock("@/lib/supabase/server", ...)` returning a chainable query builder fake, `vi.mock("@/lib/mail/accounts", ...)`, `vi.mock("@/lib/mail/smtp", ...)`. Drive `runDue()` with two due rows where the first `sendMail` rejects: assert the result is `{ sent: 1, failed: 1 }` and the failed row got a `status: 'failed'` update — proving per-row isolation (`scheduled.ts:167-195`).
   - `onedriveTools.test.ts`: `vi.mock` the mail/onedrive/tavily/memory deps. Assert the three `executeTool` cases in the Acceptance Criteria.
6. **`secrets.test.ts`** — import `encryptSecret`/`decryptSecret` from `@/lib/crypto/secrets` (re-confirmed in step 1). Round-trip: `decryptSecret(encryptSecret(plain)) === plain` and `encryptSecret(plain) !== plain`.
7. **`session.test.ts`** — import the real Phase-1 session util (path/exports from step 1). `verify(sign("Wency")) === "Wency"` (or the util's equivalent shape) and `verify("garbage.token")` rejects/returns null.
8. Run `npm test` and `npx tsc --noEmit`; both must be clean before committing.

**Validation:** (builder self-check)
- `grep -c '"test": "vitest run"' package.json` → `1`
- `grep -c '"vitest"' package.json` → `1`
- `test -f vitest.config.ts && echo EXISTS` → `EXISTS`
- `npx vitest run 2>&1 | tail -5` → ends with a passing summary (no `failed`, no `FAIL`)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `ls src/lib/microsoft/graph.test.ts src/lib/microsoft/onedrive.test.ts src/lib/mail/imap.test.ts src/lib/mail/smtp.test.ts src/lib/mail/scheduled.test.ts src/lib/crypto/secrets.test.ts src/lib/agents/onedriveTools.test.ts 2>&1 | grep -c "No such"` → `0` (all seam/crypto test files exist; the session test exists at `src/lib/auth/session.test.ts` or the path step-1 discovery found)

**Context:** Read @src/lib/microsoft/graph.ts, @src/lib/microsoft/onedrive.ts, @src/lib/mail/imap.ts, @src/lib/mail/smtp.ts, @src/lib/mail/scheduled.ts, @src/lib/mail/accounts.ts, @src/lib/agents/onedriveTools.ts (the `executeTool` switch at :571 + `send_email` case at :675), @tsconfig.json (`@/` alias at :25-29), @package.json (scripts + devDeps shape), @.planning/decisions/ADR-001-access-control-strategy.md (Phase-1 artifacts — `src/proxy.ts` at :29), @rules/architecture.md (§6 seam-test priority).

## Success Criteria
- [ ] `supabase/migrations/0007_scheduled_emails.sql` exists and creates `scheduled_emails` with all 11 columns + the four-value status check + RLS-on/no-policy; `npx supabase db diff` is clean (or the schema-match self-check passes if no local stack).
- [ ] `mail_accounts` has exactly one authoritative email-uniqueness rule (the plain `unique(email)`); the redundant `lower(email)` expression index is dropped by `0008`.
- [ ] `vitest` is a devDependency and `npm test` runs the suite green.
- [ ] Seam tests pass for Graph, OneDrive ops, IMAP read, SMTP send, and `runDue()` per-row isolation — all with vendors mocked.
- [ ] The Phase-2 encryption round-trip and Phase-1 session sign/verify tests pass against the real utils.
- [ ] The agent tool-dispatch test passes (success path, validation-error path, unknown-tool no-throw path).
- [ ] `npx tsc --noEmit` is clean.

## Verification Contract

### Contract for Task 1 — scheduled_emails migration (exists)
**Check type:** file-exists
**Command:** `test -f supabase/migrations/0007_scheduled_emails.sql && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — scheduled_emails columns complete
**Check type:** command-exit
**Command:** `grep -Eo "(from_email|to_email|subject|body|scheduled_at|status|sent_at|error|created_by|created_at)" supabase/migrations/0007_scheduled_emails.sql | sort -u | wc -l`
**Expected:** `10`
**Fail if:** Fewer than 10 — a column the code reads/writes (per `scheduled.ts:29-41`) is missing from the migration

### Contract for Task 1 — status check + RLS present
**Check type:** command-exit
**Command:** `grep -c "in ('pending','sent','failed','cancelled')" supabase/migrations/0007_scheduled_emails.sql && grep -c "enable row level security" supabase/migrations/0007_scheduled_emails.sql`
**Expected:** Both lines output `1`
**Fail if:** Either is `0` — missing the four-value status check or the service-role RLS lockdown

### Contract for Task 2 — reconciliation migration drops the expression index
**Check type:** grep-match
**Command:** `grep -c "drop index if exists public.mail_accounts_email_unique" supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — the redundant `lower(email)` index from `0003:25` was not removed, so two constraints still coexist

### Contract for Task 2 — no new constraint added (we keep the existing plain one)
**Check type:** command-exit
**Command:** `grep -c "add constraint" supabase/migrations/0008_reconcile_mail_accounts_email_unique.sql`
**Expected:** `0`
**Fail if:** Non-zero — the migration created a third constraint instead of consolidating to the existing `mail_accounts_email_key`

### Contract for Task 3 — vitest configured with test script
**Check type:** grep-match
**Command:** `grep -c '"test": "vitest run"' package.json`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — no `npm test` script wired

### Contract for Task 3 — vitest config exists
**Check type:** file-exists
**Command:** `test -f vitest.config.ts && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 3 — seam/route/crypto test files exist
**Check type:** command-exit
**Command:** `for f in src/lib/microsoft/graph.test.ts src/lib/microsoft/onedrive.test.ts src/lib/mail/imap.test.ts src/lib/mail/smtp.test.ts src/lib/mail/scheduled.test.ts src/lib/crypto/secrets.test.ts src/lib/agents/onedriveTools.test.ts; do test -f "$f" || echo "MISSING $f"; done`
**Expected:** No output (all present). The session test exists at `src/lib/auth/session.test.ts` or the path step-1 discovery found.
**Fail if:** Any `MISSING` line for a seam/crypto test (graph/onedrive/imap/smtp/scheduled/secrets/onedriveTools); a relocated session test is acceptable only if a deviation is logged

### Contract for Task 3 — suite green
**Check type:** command-exit
**Command:** `npx vitest run 2>&1 | tail -3`
**Expected:** A passing summary line (e.g. `Test Files  8 passed`), no `failed` / `FAIL`
**Fail if:** Any test fails or vitest errors on config/alias resolution

### Contract for Task 3 — typecheck clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript error (test files must type-check under strict mode with the `@/` alias)

### Contract for Task 3 — runDue per-row isolation (behavioral, deterministic via mocks)
**Check type:** behavioral
**Command:** (verifier inspects `src/lib/mail/scheduled.test.ts`) `grep -c "failed: 1" src/lib/mail/scheduled.test.ts`
**Expected:** Non-zero — a test asserts that with one failing send the batch result is `{ sent: 1, failed: 1 }`, proving one bad row doesn't abort the batch (`scheduled.ts:167-195`)
**Fail if:** No assertion exercises the mixed sent/failed path
