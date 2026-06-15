-- Reconcile mail_accounts email uniqueness to ONE authoritative rule (REQ-7).
--
-- Two overlapping uniqueness rules existed:
--   1. mail_accounts_email_unique  — a lower(email) expression unique index (0003:25)
--   2. mail_accounts_email_key      — a plain unique(email) constraint     (0005:6)
--
-- The app upserts with ON CONFLICT (email) (accounts.ts:98), which only the plain
-- unique(email) constraint satisfies; the expression index does not. So the plain
-- constraint mail_accounts_email_key is the SINGLE authoritative rule going forward.
--
-- Case-insensitivity is guaranteed at the app layer, which always lowercases the
-- email before writing (accounts.ts:86, scheduled.ts:86-87), so the dropped
-- lower(email) index is redundant. loadAccountWithSecretByEmail reads with ilike
-- (accounts.ts:140), so case-insensitive lookups remain correct without the index.
--
-- Idempotent: drop index if exists makes this safe whether or not 0003/0005 applied.

drop index if exists public.mail_accounts_email_unique;
