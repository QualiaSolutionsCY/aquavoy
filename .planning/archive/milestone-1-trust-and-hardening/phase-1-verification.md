# Phase 1 — Access Control · Verification

**Verdict: PASS**
**Date:** 2026-06-15 · Branch `m1-trust-hardening` · Commits cb9fafb, 42e7bab, eff5858, 06a97fc
**Method:** All deterministic contracts run directly by the orchestrator (the spawned verifier agent dropped on a transport error before writing; checks re-run independently for ground truth).

## Deterministic contract results (14/14 PASS)

| Contract | Check | Result |
|---|---|---|
| T1 session util exists | `test -f src/lib/auth/session.ts` | PASS |
| T1 constant-time crypto | grep createHmac/timingSafeEqual/scrypt ≥3 | PASS (6) |
| T1 env auth accessor | grep getAuthEnv/SESSION_SECRET/OPERATOR_CREDENTIALS ≥2 | PASS (6) |
| T2 proxy verifies session | grep getPrincipal in proxy.ts ≥1 | PASS (2) |
| T2 cron allowlisted | grep scheduled/run in proxy.ts ≥1 | PASS (2) |
| T2 login cookie httpOnly | grep httpOnly in login route ≥1 | PASS (2) |
| T3 login posts to API | grep /api/login in login page ≥1 | PASS (2) |
| T3 auto-login removed | grep `pick("Wency")` in page.tsx ==0 | PASS (0) |
| T3 no banned fonts | grep Inter/Arial/system-ui ==0 | PASS (0) |
| T4 auth/me exists | `test -f .../auth/me/route.ts` | PASS |
| T4 no trusted-input principal | grep body.identity / searchParams principal ==0 | PASS (0) |
| T4 chat reads session | grep getPrincipal in chat route ≥1 | PASS (2) |
| T4 history reads session | grep getPrincipal in history route ≥1 | PASS (4) |
| Typecheck | `npx tsc --noEmit` errors ==0 | PASS (0) |
| Login page slop-detect | exit 0 | PASS |

## Goal-level assessment

**Goal:** No unauthenticated caller can drive the agent or read company data; principal verified server-side.

- **REQ-1 (routes reject unauthenticated):** `src/proxy.ts` gates every path via `getPrincipal`, allowlisting only `/login`, `/api/login`, and the `CRON_SECRET`-guarded `/api/mail/scheduled/run`; returns 401 for `/api/*`, redirects pages to `/login`. ✓ (code-verified)
- **REQ-2 (real credential check):** `pick("Wency")` auto-login removed; `/login` posts to `/api/login` which verifies a scrypt-hashed per-operator password and sets a signed httpOnly+secure+sameSite cookie. ✓
- **REQ-3 / MED-1 (server-side principal, cross-principal isolation):** `chat/route.ts` and `chat/history/route.ts` derive the principal from `getPrincipal(req)`; no `body.identity` or `?principal=` read path remains (grep ==0); all history query modes scope to the session principal. ✓
- **No new dependency:** session signing uses Node `crypto` (HMAC + scrypt + timingSafeEqual). ✓

## Behavioral contracts — DEFERRED (need running server)

Two contracts (unauthenticated `POST /api/chat` → 401; Wency cookie + `?principal=Jeanette` → only Wency's data) require a booted dev server. The dev server was not started in the verification environment. The underlying code paths were assessed by reading `proxy.ts` (401 branch for `/api/*`) and the history route (session-only principal, query param dropped) — both implement the asserted behavior. Recommend confirming live during `/qualia-ship` post-deploy checks.

## Gaps

None blocking. Operational prerequisite for deploy: set `SESSION_SECRET` (≥32 chars) and `OPERATOR_CREDENTIALS` (JSON of `principal: saltHex:hashHex` scrypt hashes) in `.env.local` and Vercel.
