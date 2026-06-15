---
phase: 2
goal: "No plaintext secrets in Postgres — mailbox passwords and OAuth access/refresh tokens stored encrypted, decrypted only server-side at point of use."
tasks: 3
waves: 2
---

# Phase 2: Credentials at Rest

**Goal:** No plaintext mailbox passwords or OAuth tokens in Postgres. Secrets are encrypted with AES-256-GCM under a key from env, written encrypted, and decrypted only inside the server-side `WithSecret`/token accessors at the moment of SMTP/IMAP/Graph use.
**Why this phase:** Closes concerns.md HIGH-2 — `mail_accounts.password` and `onedrive_connections.access_token`/`refresh_token` sit in plaintext today (`accounts.ts:62,92`, `connections.ts:30-31`), a live-credential exposure if the service-role key or a DB backup leaks.

---

## Task 1 — Server-only AES-256-GCM secret crypto util + env key

**Wave:** 1
**Persona:** security
**Files:**
- CREATE `src/lib/crypto/secrets.ts` — exports `encryptSecret(plaintext: string): string`, `decryptSecret(stored: string): string`, `isEncrypted(stored: string): boolean`.
- MODIFY `src/lib/env.ts` — add a `getCryptoEnv()` lazy accessor (`ENCRYPTION_KEY`, 32-byte base64) following the existing per-feature pattern.
**Depends on:** none

**Why:** Every later task encrypts/decrypts through one seam; without a single authenticated-encryption util each call site would hand-roll crypto and drift. AES-256-GCM is authenticated (tamper-evident) and ships in Node's built-in `crypto` — no new npm dependency, honoring the approach guidance.

**Acceptance Criteria:**
- `encryptSecret("hunter2")` returns a string of the form `iv:authTag:ciphertext` where each segment is base64; calling it twice on the same input yields different output (random 12-byte IV per call).
- `decryptSecret(encryptSecret(x)) === x` for any UTF-8 string `x` (round-trip).
- `decryptSecret` of a value that is NOT in the `iv:authTag:ciphertext` shape (i.e. a legacy plaintext password or a raw JWT) returns the input unchanged — tolerant read, no throw.
- `isEncrypted(s)` returns `true` only for the 3-segment base64 GCM shape with a 12-byte IV and 16-byte auth tag, `false` for plaintext.
- `getCryptoEnv()` throws a clear `Invalid crypto configuration` error if `ENCRYPTION_KEY` is missing or not exactly 32 bytes when base64-decoded.

**Action:**
1. In `src/lib/env.ts`, add after the Tavily block (mirroring `getTavilyEnv` at `env.ts:67-74`):
   ```ts
   // ── Crypto (secret encryption at rest) ────────────────────
   const cryptoSchema = z.object({
     ENCRYPTION_KEY: z
       .string()
       .min(1, "ENCRYPTION_KEY is required")
       .refine(
         (v) => { try { return Buffer.from(v, "base64").length === 32; } catch { return false; } },
         "ENCRYPTION_KEY must be 32 bytes, base64-encoded",
       ),
   });
   let cryptoCache: z.infer<typeof cryptoSchema> | null = null;
   export function getCryptoEnv() {
     return (cryptoCache ??= validate(cryptoSchema, "crypto"));
   }
   ```
2. In `src/lib/crypto/secrets.ts`, import `randomBytes, createCipheriv, createDecipheriv` from `node:crypto` and `getCryptoEnv` from `@/lib/env`. Resolve the key once per call via `Buffer.from(getCryptoEnv().ENCRYPTION_KEY, "base64")` (the env cache makes this cheap).
3. `encryptSecret`: generate a 12-byte IV (`randomBytes(12)`), `createCipheriv("aes-256-gcm", key, iv)`, update+final the plaintext, read `cipher.getAuthTag()` (16 bytes), return `[iv, authTag, ciphertext].map(b => b.toString("base64")).join(":")`.
4. `decryptSecret`: if `!isEncrypted(stored)` return `stored` verbatim (tolerant read of legacy plaintext). Otherwise split on `:`, base64-decode the three parts, `createDecipheriv("aes-256-gcm", key, iv)`, `setAuthTag(authTag)`, update+final, return utf8. Let a genuine GCM auth failure throw (tampered ciphertext must not silently pass).
5. `isEncrypted`: split on `:`; require exactly 3 parts; base64-decode each in a try/catch; require `iv.length === 12 && authTag.length === 16 && ciphertext.length >= 1`; return false on any mismatch. A bcrypt-style or JWT password will not satisfy this (JWTs use `.` separators and base64url, IMAP passwords are arbitrary text).
6. File header comment: document the `iv:authTag:ciphertext` (all base64) format, that the module is server-only, and the key-rotation path (re-encrypt: read-with-old-key script is future work; rotation = set new `ENCRYPTION_KEY`, run a one-time re-encrypt — note this in the comment but do not implement rotation tooling this phase).

**Validation:** (builder self-check)
- `node -e "const k=require('crypto').randomBytes(32).toString('base64'); process.env.ENCRYPTION_KEY=k; const {encryptSecret,decryptSecret,isEncrypted}=require('./src/lib/crypto/secrets.ts'); /* run via tsx-free check below */"` — if no runtime TS, instead validate via tsc.
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect `0`.
- `grep -E "createCipheriv|aes-256-gcm|getAuthTag|setAuthTag" src/lib/crypto/secrets.ts` → expect ≥4 matches (all GCM primitives present).
- `grep -c "node:crypto" src/lib/crypto/secrets.ts` → expect `1` (uses Node built-in, no new dependency).

**Context:** Read @src/lib/env.ts (per-feature lazy-zod pattern to mirror), @.planning/codebase/concerns.md (HIGH-2, the exposure this closes).

---

## Task 2 — Encrypt mailbox passwords at rest in `mail/accounts.ts`

**Wave:** 2
**Persona:** security
**Files:**
- MODIFY `src/lib/mail/accounts.ts` — encrypt on write in `saveAccount`, decrypt on read in `toMailAccountWithSecret`.
**Depends on:** Task 1

**Why:** Mailbox passwords for the 12 live company mailboxes are written/read in plaintext (`accounts.ts:92` writes `password: fields.password`; `accounts.ts:62` returns `password: row.password`). Encrypting here — and ONLY here — keeps the public `MailAccount` shape (`accounts.ts:14-25`) secret-free while the SMTP/IMAP send path keeps working through `MailAccountWithSecret`.

**Acceptance Criteria:**
- After `saveAccount({...password:"pw"})`, the `mail_accounts.password` column holds an `iv:authTag:ciphertext` string, not `pw` — verifiable by reading the row directly.
- `loadAccountWithSecret(id).password` and `loadAccountWithSecretByEmail(email).password` return the original plaintext `pw` (decrypt happens in the accessor).
- `listAccounts()` and the `MailAccount` public shape still expose NO password field (unchanged — `accounts.ts:104-113`, `:14-25`).
- An existing row written before this change (plaintext password) is still readable: `loadAccountWithSecret` returns it verbatim via the tolerant `decryptSecret`, and the NEXT `saveAccount` upsert of that account re-writes it encrypted (self-healing backfill — no broken rows, no separate migration script).

**Action:**
1. Import at top of `accounts.ts`: `import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";`.
2. In `saveAccount` (`accounts.ts:67-102`), change the upsert payload line `password: fields.password,` (`:92`) to `password: encryptSecret(fields.password),`.
3. In `toMailAccountWithSecret` (`accounts.ts:59-64`), change `password: row.password,` (`:62`) to `password: decryptSecret(row.password),`. Because both `loadAccountWithSecret` and `loadAccountWithSecretByEmail` funnel through this mapper, both read paths decrypt with one edit.
4. Do NOT touch `toMailAccount`, `listAccounts`, or the public `MailAccount` interface — the secret split is preserved.
5. The self-healing backfill is implicit: legacy plaintext rows pass through `decryptSecret` unchanged (tolerant read from Task 1), and any re-verify/re-save through the Emails page re-encrypts. No standalone backfill script — state this in a one-line comment above the `encryptSecret` call so a future reader understands the migration story.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect `0`.
- `grep -c "encryptSecret(fields.password)" src/lib/mail/accounts.ts` → expect `1` (write path encrypts).
- `grep -c "decryptSecret(row.password)" src/lib/mail/accounts.ts` → expect `1` (read path decrypts).
- `grep -nE "password: row.password|password: fields.password" src/lib/mail/accounts.ts` → expect NO matches (no remaining plaintext pass-through).
- `grep -c "password" src/lib/mail/accounts.ts | head` and confirm `MailAccount` interface (`:14-25`) still has no `password` field: `sed -n '14,25p' src/lib/mail/accounts.ts | grep -c "password"` → expect `0`.

**Context:** Read @src/lib/mail/accounts.ts (full file — the read/write split this preserves), @src/lib/crypto/secrets.ts (Task 1 output — the encrypt/decrypt seam).

---

## Task 3 — Encrypt OAuth access/refresh tokens at rest in `microsoft/connections.ts`

**Wave:** 2
**Persona:** security
**Files:**
- MODIFY `src/lib/microsoft/connections.ts` — encrypt tokens on every write (`saveConnection`, the refresh-persist in `getValidAccessToken`), decrypt on read in `loadRow` and at the early-return token path.
**Depends on:** Task 1

**Why:** `onedrive_connections.access_token`/`refresh_token` are persisted in plaintext by `saveConnection` (`connections.ts:55-56`) and re-persisted plaintext on refresh (`connections.ts:120-121`); the still-valid token is returned plaintext at `connections.ts:112`. These grant delegated Graph access to company OneDrive + mailboxes — same HIGH-2 exposure as passwords (concerns.md:41).

**Acceptance Criteria:**
- After `saveConnection(user, tokens)`, `onedrive_connections.access_token` and `refresh_token` columns hold `iv:authTag:ciphertext`, not the raw JWT/refresh string.
- `getValidAccessToken(id)` returns a usable PLAINTEXT access token in both branches: (a) token still fresh → decrypts the stored token before returning (`connections.ts:112`); (b) token expired → calls `refreshTokens` with the DECRYPTED refresh token, then persists the new pair encrypted.
- `refreshTokens(row.refresh_token)` (`connections.ts:114`) receives a decrypted refresh token — Microsoft's token endpoint must get the real value, never ciphertext.
- `listConnections()` still returns NO tokens (unchanged — it selects only id/ms_user_id/principal/display_name, `connections.ts:76`).
- A legacy connection row with plaintext tokens keeps working: `decryptSecret` returns them verbatim (tolerant read), and the next `saveConnection` upsert OR the next refresh re-persists them encrypted (self-healing — no separate backfill).

**Action:**
1. Import at top of `connections.ts`: `import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";`.
2. In `saveConnection` (`connections.ts:47-69`), change the upsert payload: `access_token: tokens.accessToken,` → `access_token: encryptSecret(tokens.accessToken),` and `refresh_token: tokens.refreshToken,` → `refresh_token: encryptSecret(tokens.refreshToken),` (`:55-56`).
3. In `getValidAccessToken` (`connections.ts:108-129`):
   - Fresh branch (`:111-113`): `return row.access_token;` → `return decryptSecret(row.access_token);`.
   - Refresh call (`:114`): `const next = await refreshTokens(row.refresh_token);` → `const next = await refreshTokens(decryptSecret(row.refresh_token));`.
   - Re-persist update (`:118-125`): `access_token: next.accessToken,` → `access_token: encryptSecret(next.accessToken),` and `refresh_token: next.refreshToken,` → `refresh_token: encryptSecret(next.refreshToken),`.
   - Return (`:128`): `return next.accessToken;` stays plaintext (it is the in-memory fresh value from `refreshTokens`, not from the DB) — correct as-is.
4. `loadRow` (`connections.ts:82-87`) returns the raw `ConnectionRow` (still-encrypted tokens); decryption happens at the use sites above, so `loadRow` is unchanged. Do NOT decrypt inside `loadRow` — `expires_at` and other fields are consumed raw and only the two token fields need decoding at point of use.
5. `toConnection` and `listConnections` are unchanged (they never touch token columns) — the secret split is preserved.
6. Add a one-line comment above the `encryptSecret` calls in `saveConnection` noting the self-healing backfill (legacy plaintext rows tolerated on read, re-encrypted on next save/refresh).

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → expect `0`.
- `grep -c "encryptSecret(" src/lib/microsoft/connections.ts` → expect `4` (2 in saveConnection, 2 in refresh-persist).
- `grep -c "decryptSecret(" src/lib/microsoft/connections.ts` → expect `2` (fresh-token return + refresh-token arg).
- `grep -nE "refreshTokens\(row.refresh_token\)" src/lib/microsoft/connections.ts` → expect NO match (must be wrapped in `decryptSecret`).
- `grep -nE "access_token: tokens.accessToken|refresh_token: tokens.refreshToken|access_token: next.accessToken|refresh_token: next.refreshToken" src/lib/microsoft/connections.ts` → expect NO matches (no remaining plaintext writes).

**Context:** Read @src/lib/microsoft/connections.ts (full file — both write paths and the dual-branch read in `getValidAccessToken`), @src/lib/crypto/secrets.ts (Task 1 output).

---

## Success Criteria
- [ ] `mail_accounts.password` is stored encrypted (`iv:authTag:ciphertext`); SMTP/IMAP send still works because `MailAccountWithSecret` decrypts at point of use. (REQ-4)
- [ ] `onedrive_connections.access_token` and `refresh_token` are stored encrypted; `getValidAccessToken` returns a usable plaintext token and refresh still works against Microsoft's endpoint. (REQ-5)
- [ ] Encryption key is sourced from `ENCRYPTION_KEY` env (32-byte base64, validated lazily), never committed; rotation path documented in `secrets.ts`.
- [ ] Public accessors (`MailAccount`, `listAccounts`, `Connection`, `listConnections`) still expose NO secrets — the existing secret/no-secret split is unchanged.
- [ ] Existing plaintext rows are NOT broken: tolerant `decryptSecret` reads them verbatim and the next write re-encrypts (self-healing backfill, no orphaned data).
- [ ] No new npm dependency added (`package.json` dependencies unchanged); crypto is Node built-in `node:crypto`.
- [ ] `npx tsc --noEmit` clean.

---

## Verification Contract

### Contract for Task 1 — crypto util exists
**Check type:** file-exists
**Command:** `test -f src/lib/crypto/secrets.ts && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist.

### Contract for Task 1 — uses Node built-in GCM, no new dependency
**Check type:** grep-match
**Command:** `grep -cE "node:crypto|aes-256-gcm" src/lib/crypto/secrets.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — crypto not implemented with the Node built-in AES-256-GCM primitive.

### Contract for Task 1 — exports the three functions
**Check type:** grep-match
**Command:** `grep -cE "export function (encryptSecret|decryptSecret|isEncrypted)" src/lib/crypto/secrets.ts`
**Expected:** `3`
**Fail if:** Fewer than 3 — a required export is missing.

### Contract for Task 1 — env key accessor added
**Check type:** grep-match
**Command:** `grep -cE "ENCRYPTION_KEY|getCryptoEnv" src/lib/env.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — env contract not extended; key has no validated source.

### Contract for Task 1 — no new npm dependency
**Check type:** command-exit
**Command:** `git diff --stat package.json | grep -c dependencies; grep -cE "\"(bcrypt|crypto-js|tweetnacl|libsodium)" package.json`
**Expected:** Second grep returns `0`
**Fail if:** A crypto npm package was added — the approach mandates Node built-in only.

### Contract for Task 2 — mail password encrypted on write
**Check type:** grep-match
**Command:** `grep -c "encryptSecret(fields.password)" src/lib/mail/accounts.ts`
**Expected:** `1`
**Fail if:** Returns 0 — `saveAccount` still writes plaintext.

### Contract for Task 2 — mail password decrypted on read
**Check type:** grep-match
**Command:** `grep -c "decryptSecret(row.password)" src/lib/mail/accounts.ts`
**Expected:** `1`
**Fail if:** Returns 0 — the `WithSecret` accessor does not decrypt; SMTP/IMAP send would receive ciphertext.

### Contract for Task 2 — no plaintext password pass-through remains
**Check type:** command-exit
**Command:** `grep -cE "password: (row.password|fields.password)" src/lib/mail/accounts.ts`
**Expected:** `0`
**Fail if:** Non-zero — a raw plaintext read or write path survived.

### Contract for Task 2 — public shape still secret-free
**Check type:** command-exit
**Command:** `sed -n '14,25p' src/lib/mail/accounts.ts | grep -c "password"`
**Expected:** `0`
**Fail if:** Non-zero — the public `MailAccount` interface leaked the password field.

### Contract for Task 3 — OAuth tokens encrypted on write (4 sites)
**Check type:** grep-match
**Command:** `grep -c "encryptSecret(" src/lib/microsoft/connections.ts`
**Expected:** `4`
**Fail if:** Fewer than 4 — a token write path (saveConnection ×2 or refresh-persist ×2) still stores plaintext.

### Contract for Task 3 — OAuth tokens decrypted on read (2 sites)
**Check type:** grep-match
**Command:** `grep -c "decryptSecret(" src/lib/microsoft/connections.ts`
**Expected:** `2`
**Fail if:** Fewer than 2 — either the fresh-token return or the refresh-token argument is not decrypted (refresh against Microsoft would fail with ciphertext).

### Contract for Task 3 — refresh token decrypted before use
**Check type:** command-exit
**Command:** `grep -cE "refreshTokens\(row\.refresh_token\)" src/lib/microsoft/connections.ts`
**Expected:** `0`
**Fail if:** Non-zero — `refreshTokens` is called with ciphertext instead of the decrypted refresh token.

### Contract for Task 3 — no plaintext token write remains
**Check type:** command-exit
**Command:** `grep -cE "access_token: (tokens.accessToken|next.accessToken)|refresh_token: (tokens.refreshToken|next.refreshToken)" src/lib/microsoft/connections.ts`
**Expected:** `0`
**Fail if:** Non-zero — a raw plaintext token write survived.

### Contract for phase — compiles clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation error.
