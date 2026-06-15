---
phase: 1
goal: "No unauthenticated caller can drive the agent or read company data; the principal is verified server-side, not trusted from request input."
tasks: 4
waves: 3
---

# Phase 1: Access Control

**Goal:** No unauthenticated caller can drive the agent or read company data; the principal is verified server-side, not trusted from request input.
**Why this phase:** Closes codebase-map HIGH-1 (every mutating/PII API route is currently callable by anyone) and MED-1 (`principal` is a free query param, so either operator can read the other's chat history). Implements ADR-001 — app password + signed httpOnly session cookie.

> **Locked decision (ADR-001) deviation note — read before T2.** ADR-001 names `src/middleware.ts`. The current stack is **Next.js 16**, where `middleware.ts` is *deprecated and renamed to `proxy.ts`* (`next@16` docs, version history `v16.0.0`: "Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime"). The ADR's substance — a route guard in front of the app that rejects every request without a valid session except the allowlist — is preserved; only the file convention is updated to the framework's current name. T2 creates `src/proxy.ts`. This is a grounding-driven correction to a locked decision that predates checking the Next 16 API; everything else in ADR-001 (signed httpOnly cookie, per-operator password, principal-from-session) is honored verbatim.

---

## Task 1 — Session signing/verification util + per-operator credential check
**Wave:** 1
**Persona:** security
**Files:**
- CREATE `src/lib/auth/session.ts` — exports `signSession(principal: Principal): string`, `verifySession(token: string | undefined): Principal | null`, `getPrincipal(req: NextRequest): Principal | null`, `verifyCredential(principal: string, password: string): boolean`, and `SESSION_COOKIE = "aq_session"`.
- MODIFY `src/lib/env.ts` — add an `authSchema` + `getAuthEnv()` following the existing per-feature pattern (`env.ts:35-43`).
**Depends on:** none

**Why:** ADR-001 requires the verified principal to be carried in a signed httpOnly cookie and read server-side. Every other task in this phase depends on this seam existing: the proxy verifies the cookie, the login API signs it, the chat/history routes read the principal from it. Centralizing sign/verify in one module is the adapter seam (per `rules/architecture.md` §3) — swapping to Supabase Auth later changes only this file.

**Acceptance Criteria:**
- `signSession("Wency")` returns a string of the form `Wency.<base64url-hmac>`; `verifySession` of that string returns `"Wency"`; `verifySession` of a tampered string (changed principal or signature) returns `null`.
- `verifyCredential("Wency", correctPassword)` returns `true`; wrong password or unknown principal returns `false`; comparison is constant-time.
- No new npm dependency is added — `package.json` `dependencies` is unchanged (verified: only `crypto` from Node stdlib is imported).

**Action:**
1. Use Node's built-in `node:crypto` — no bcrypt (none installed, confirmed `package.json:12-24`). For the HMAC: `crypto.createHmac("sha256", SESSION_SECRET).update(principal).digest("base64url")`. The cookie value is `${principal}.${hmac}`. `verifySession` splits on the last `.`, recomputes the HMAC over the principal segment, and compares with `crypto.timingSafeEqual` (guard unequal buffer lengths first — `timingSafeEqual` throws on length mismatch). Confirm the principal is in `PRINCIPALS` (import from `@/lib/openrouter/client` — `client.ts` exports `PRINCIPALS` and the `Principal` type, used at `chat/route.ts:2`).
3. `getPrincipal(req: NextRequest)` reads `req.cookies.get(SESSION_COOKIE)?.value` and delegates to `verifySession`.
4. `verifyCredential` reads the per-operator credential map from `getAuthEnv()`. Store credentials as scrypt hashes in env (format `salt:hash` hex). Compute `crypto.scryptSync(password, salt, 64)` and compare to the stored hash with `crypto.timingSafeEqual`. Map env var `OPERATOR_CREDENTIALS` = JSON string `{"Wency":"<saltHex>:<hashHex>","Jeanette":"<saltHex>:<hashHex>"}`; parse + validate with zod in `authSchema`.
5. `authSchema` (in `env.ts`): `{ SESSION_SECRET: z.string().min(32), OPERATOR_CREDENTIALS: z.string().min(1) }`. Add `getAuthEnv()` with the same lazy-cache pattern as `getOpenRouterEnv` (`env.ts:40-43`). Keep `SESSION_SECRET` server-only (no `NEXT_PUBLIC_` prefix — `env.ts` is documented server-only at `env.ts:6-10`).

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `grep -c "createHmac\|timingSafeEqual\|scrypt" src/lib/auth/session.ts` → ≥ `3`
- `git diff --stat package.json | grep -c package.json` → `0` (no dependency added)

**Context:** Read @.planning/decisions/ADR-001-access-control-strategy.md, @src/lib/env.ts, @src/app/api/chat/route.ts (for the `PRINCIPALS`/`Principal` import shape), @rules/security.md

---

## Task 2 — Route-guard proxy + `POST /api/login` + `POST /api/logout`
**Wave:** 2
**Persona:** security
**Files:**
- CREATE `src/proxy.ts` — exports default `proxy(request)` + `config.matcher`. Guards every route except the allowlist; redirects unauthenticated page requests to `/login`, returns 401 JSON for unauthenticated `/api/*` requests.
- CREATE `src/app/api/login/route.ts` — `POST` verifies `{ principal, password }`, sets the signed httpOnly cookie on success.
- CREATE `src/app/api/logout/route.ts` — `POST` clears the session cookie.
**Depends on:** Task 1

**Why:** ADR-001: `proxy.ts` guards every route except `/login`, `POST /api/login`, and the `CRON_SECRET`-protected cron runner; `POST /api/login` verifies the password and sets the signed cookie. Without this no request is actually gated. The cron runner MUST stay reachable by Vercel cron (it has its own `CRON_SECRET` bearer guard at `mail/scheduled/run/route.ts:18`) — excluding it from the proxy preserves the existing, working protection.

**Acceptance Criteria:**
- An unauthenticated browser request to `/`, `/emails`, `/files`, or `/prep` is redirected (307) to `/login`.
- An unauthenticated `fetch` to `POST /api/chat` or `GET /api/chat/history` returns HTTP 401 with `{ ok: false, error: ... }` — it never reaches the handler.
- `POST /api/login` with a correct `{ principal, password }` returns 200 and a `Set-Cookie: aq_session=...; HttpOnly; Secure; SameSite=Lax; Path=/`; with a wrong password returns 401 and sets no cookie.
- `GET /api/mail/scheduled/run` with the correct `Bearer CRON_SECRET` still returns 200 (cron is on the allowlist, untouched).
- `POST /api/logout` clears the cookie and returns 200.

**Action:**
1. `src/proxy.ts`: import `getPrincipal` from `@/lib/auth/session` and `NextResponse` from `next/server`. The proxy runs on the Node.js runtime by default in Next 16 (docs version history `v16.0.0`), so `node:crypto` inside `session.ts` is available — do NOT set a `runtime` config (it throws in proxy files per the Next 16 docs).
2. Allowlist (return `NextResponse.next()` without a session check): pathname `=== "/login"`, `=== "/api/login"`, and `=== "/api/mail/scheduled/run"`. For everything else, call `getPrincipal(request)`; if `null`: for `/api/*` paths return `NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })`, otherwise `NextResponse.redirect(new URL("/login", request.url))`.
3. `config.matcher`: `['/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:png|svg|ico|webmanifest)$).*)']` — excludes Next internals and static assets (the gate uses `/logo.png` at `page.tsx:308`), guards everything else including `/api/*`. Note: per Next 16 docs, `/api/login` is NOT excluded by the matcher (it is allowlisted inside the function instead) so the matcher stays simple and the allowlist logic is auditable in one place.
4. `src/app/api/login/route.ts`: `export const runtime = "nodejs"` + `dynamic = "force-dynamic"` (mirror `chat/route.ts:5-6`). Validate body with zod `{ principal: z.enum(["Wency","Jeanette"]), password: z.string().min(1) }`. On `verifyCredential` true: build a `NextResponse.json({ ok: true })` and call `res.cookies.set({ name: SESSION_COOKIE, value: signSession(principal), httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60*60*24*30 })`. On false: `fail("Invalid credentials", 401)` from `@/lib/http`.
5. `src/app/api/logout/route.ts`: `POST` returns `NextResponse.json({ ok: true })` with `res.cookies.set({ name: SESSION_COOKIE, value: "", maxAge: 0, path: "/" })`.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `grep -c "scheduled/run\|/api/login\|/login" src/proxy.ts` → ≥ `3` (all three allowlist entries present)
- `grep -c "httpOnly\|secure\|sameSite" src/app/api/login/route.ts` → ≥ `3`
- `grep -c "getPrincipal" src/proxy.ts` → ≥ `1` (proxy actually calls the verifier, not a stub)

**Context:** Read @.planning/decisions/ADR-001-access-control-strategy.md, @src/app/api/mail/scheduled/run/route.ts (the allowlisted cron guard to preserve), @src/lib/http.ts, @src/app/api/chat/route.ts (runtime config pattern)

---

## Task 3 — Login page + replace auto-login splash in `page.tsx`
**Wave:** 3
**Persona:** frontend
**Files:**
- CREATE `src/app/login/page.tsx` — `"use client"` login form: pick operator (Wency | Jeanette) + password, POSTs `/api/login`, redirects to `/` on success.
- MODIFY `src/app/page.tsx` — remove the auto-login `useEffect` (`page.tsx:296-301`); the page is now reached only with a valid session (proxy-guarded), so `identity` is established from the session, not picked client-side.
**Depends on:** Task 2

**Why:** ADR-001: replace the auto-login splash (`page.tsx:295-301` calls `pick("Wency")` on mount — codebase-map HIGH-1) with a real credential check. Success criterion: "App entry requires a real credential check (not the current loading splash that auto-logs in as Wency)." The chat page must no longer self-elect an identity.

**Acceptance Criteria:**
- Visiting `/login` shows a branded form: choose operator (Wency/Jeanette) and enter password, with a submit button.
- Wrong password shows an inline error (`.notice err`); correct password redirects to `/` and the chat loads with that operator's identity.
- The chat page (`/`) no longer auto-logs in as Wency — the `pick("Wency")` on-mount effect is gone; identity comes from `GET /api/auth/me` (added in T4) hydrated on mount.
- Form renders correctly at 375px and 1440px; password input and submit button are ≥ 44px touch targets; keyboard-submittable (Enter); `prefers-reduced-motion` honored on any animation.

**Action:**
1. `src/app/login/page.tsx`: `"use client"`. Reuse the existing gate visual language — wrap in `<main className="gate">` / `<div className="gate-card">` with `/logo.png` and the `.gate-credit` Qualia footer (mirror the existing splash at `page.tsx:304-318`). Add operator selection using the shipped `.pick-btn` class (`globals.css:809`) and a password `<input>` (shipped input styles). On submit: `await fetch("/api/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ principal, password }) })`; on `res.ok` → `window.location.href = "/"`; else read `json.error` into an error state rendered as `<p className="notice err">`.
2. `src/app/page.tsx`: delete the on-mount auto-login effect at `page.tsx:296-301`. Replace with an effect that calls `GET /api/auth/me` (T4) and `setIdentity(json.data.principal)`; if it returns 401, `window.location.href = "/login"`. Keep the existing `pick(name)` body for session hydration but call it with the principal returned from `/api/auth/me` instead of hardcoded `"Wency"`. Keep the splash markup (`page.tsx:304+`) as the "while identity hydrates" loading state — it is now a genuine loading state, not an auto-login.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `grep -c "pick(\"Wency\")" src/app/page.tsx` → `0` (hardcoded auto-login removed)
- `grep -c "/api/login" src/app/login/page.tsx` → ≥ `1` (form actually posts to the login API)
- `grep -c "Inter\|Arial\|system-ui" src/app/login/page.tsx` → `0` (no banned fonts)
- `node /home/qualiasolutions/.claude/bin/slop-detect.mjs src/app/login/page.tsx` → no critical findings

**Context:** Read @.planning/DESIGN.md, @src/app/page.tsx (existing gate markup + `pick` function), @src/app/globals.css (`.gate`, `.gate-card`, `.pick-btn`, `.notice`, input styles)

**Design:**
- Register: product
- Tokens used: `--bg` radial ground, `--surface`/`--surface-2` for the card, `--accent` (teal hue 192) for the active operator pick + focus ring, `--text`/`--text-dim`/`--text-muted`, `--danger` for the error notice, `--font-sans` (Instrument Sans) for labels, `--font-mono` (JetBrains Mono) for the operator name tags, `--radius`/`--radius-lg`, `--sp-*` 8px grid, `--ease-out` for `gate-logo-in`.
- Scope: page
- Anti-pattern guard: builder runs `node /home/qualiasolutions/.claude/bin/slop-detect.mjs src/app/login/page.tsx` pre-commit; commit blocked on critical findings.

---

## Task 4 — Read principal from session in chat + history routes (drop trusted input)
**Wave:** 2
**Persona:** security
**Files:**
- MODIFY `src/app/api/chat/route.ts` — derive `identity` from the session cookie via `getPrincipal(req)`, not from `body.identity` (`chat/route.ts:24-31`).
- MODIFY `src/app/api/chat/history/route.ts` — derive `principal` from the session cookie for GET/POST/DELETE, not from the `principal` query param / body (`chat/history/route.ts:36-38,:190,:207-209`).
- CREATE `src/app/api/auth/me/route.ts` — `GET` returns `{ ok: true, data: { principal } }` from the session, or 401.
**Depends on:** Task 1

**Why:** ADR-001 + REQ-3 + codebase-map MED-1: `chat/route.ts:28-31` whitelists `identity` from the request body and `chat/history/route.ts` keys reads/writes on the unverified `principal` query param (`:36`, `:190`, `:207`) — so either operator can read the other's history by changing the param. Reading the principal from the verified session closes this. `GET /api/auth/me` is the client's way to learn its own session identity (consumed by T3's `page.tsx` rewrite).

**Acceptance Criteria:**
- `POST /api/chat` ignores any `identity` in the request body and uses only the session principal; a request whose body claims `identity: "Jeanette"` but whose cookie is Wency's runs as Wency.
- `GET /api/chat/history` (all three modes: latest, `view=sessions`, `sessionId`) scopes to the session principal and ignores the `principal` query param; a Wency session cannot fetch Jeanette's history regardless of query string.
- `POST /api/chat/history` persists under the session principal, not a body-supplied `principal`.
- `GET /api/auth/me` returns the session principal (200) or 401 when unauthenticated.

**Action:**
1. `chat/route.ts`: replace the `body.identity` whitelist block (`:27-31`) with `const identity = getPrincipal(req) ?? undefined;` (import `getPrincipal` from `@/lib/auth/session`). Remove `identity` from the destructured body type (`:22`). The proxy already 401s unauthenticated callers, but read defensively — if `getPrincipal` returns `null`, return `NextResponse.json({ ok:false, error:"Unauthorized" }, { status:401 })` before doing any work.
2. `chat/history/route.ts` GET: replace `principalParam.safeParse(req.nextUrl.searchParams.get("principal"))` (`:36-38`) with `const principal = getPrincipal(req); if (!principal) return fail("Unauthorized", 401);` then use `principal` directly in every `.eq("principal", ...)` (`:52,:126,:148,:159`). Drop the `principal` query-param read entirely.
3. `chat/history/route.ts` POST: remove `principal` from `postBody` (`:13-21`); take it from `getPrincipal(req)` (`:190`). DELETE: same — derive from session, drop the query param (`:207-209`).
4. `src/app/api/auth/me/route.ts`: `export const runtime = "nodejs"` + `dynamic`. `GET` → `const p = getPrincipal(req); return p ? ok({ principal: p }) : fail("Unauthorized", 401)` using `@/lib/http`.

**Validation:** (builder self-check)
- `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `grep -c "body.identity\|searchParams.get(\"principal\")" src/app/api/chat/route.ts src/app/api/chat/history/route.ts` → `0` (no trusted-input principal remains)
- `grep -c "getPrincipal" src/app/api/chat/route.ts src/app/api/chat/history/route.ts src/app/api/auth/me/route.ts` → ≥ `3`

**Context:** Read @src/app/api/chat/route.ts, @src/app/api/chat/history/route.ts, @src/lib/http.ts, @.planning/decisions/ADR-001-access-control-strategy.md

---

## Success Criteria
- [ ] App entry requires a real credential check — `/login` form verifies a per-operator password before the app is reachable; the `pick("Wency")` auto-login is gone (REQ-2).
- [ ] Every API route except `/api/login` and the `CRON_SECRET` cron runner rejects unauthenticated requests with 401 (REQ-1).
- [ ] The authenticated session establishes the principal server-side; `body.identity` and the `principal` query param are no longer trusted (REQ-3, MED-1).
- [ ] One principal cannot read another principal's chat history — history is scoped to the session principal regardless of query string (REQ-3).
- [ ] No new npm dependency added; session signing uses Node's `crypto` (HMAC + scrypt + timingSafeEqual).

---

## Verification Contract

### Contract for Task 1 — session util exists
**Check type:** file-exists
**Command:** `test -f src/lib/auth/session.ts && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist

### Contract for Task 1 — crypto primitives, no new dep
**Check type:** grep-match
**Command:** `grep -c "createHmac\|timingSafeEqual\|scrypt" src/lib/auth/session.ts`
**Expected:** Non-zero (≥ 3)
**Fail if:** Returns < 3 — signing/verification not implemented with constant-time crypto

### Contract for Task 1 — getAuthEnv wired in env
**Check type:** grep-match
**Command:** `grep -c "getAuthEnv\|SESSION_SECRET\|OPERATOR_CREDENTIALS" src/lib/env.ts`
**Expected:** Non-zero (≥ 2)
**Fail if:** Returns 0 — env contract for the secret/credentials missing

### Contract for Task 2 — proxy guards via the session verifier
**Check type:** grep-match
**Command:** `grep -c "getPrincipal" src/proxy.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — proxy exists but does not actually verify the session (stub guard)

### Contract for Task 2 — cron + login allowlisted (cron not broken)
**Check type:** grep-match
**Command:** `grep -c "scheduled/run" src/proxy.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — cron runner not allowlisted; the per-minute Vercel cron will start 401ing

### Contract for Task 2 — login cookie is httpOnly + secure
**Check type:** grep-match
**Command:** `grep -c "httpOnly" src/app/api/login/route.ts`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — session cookie not httpOnly, readable by client JS

### Contract for Task 2 — typecheck clean
**Check type:** command-exit
**Command:** `npx tsc --noEmit 2>&1 | grep -c "error TS"`
**Expected:** `0`
**Fail if:** Any TypeScript compilation errors

### Contract for Task 3 — login page posts to the API
**Check type:** grep-match
**Command:** `grep -c "/api/login" src/app/login/page.tsx`
**Expected:** Non-zero (≥ 1)
**Fail if:** Returns 0 — login form does not call the login API

### Contract for Task 3 — auto-login removed
**Check type:** grep-match
**Command:** `grep -c 'pick("Wency")' src/app/page.tsx`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — the auto-login-as-Wency splash still elects an identity client-side

### Contract for Task 3 — no banned fonts on the login page
**Check type:** grep-match
**Command:** `grep -c "Inter\|Arial\|system-ui" src/app/login/page.tsx`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — design-system typography violated

### Contract for Task 4 — no trusted-input principal remains
**Check type:** grep-match
**Command:** `grep -c 'body.identity\|searchParams.get("principal")' src/app/api/chat/route.ts src/app/api/chat/history/route.ts`
**Expected:** `0`
**Fail if:** Returns ≥ 1 — a route still trusts the principal from request input

### Contract for Task 4 — routes read principal from session
**Check type:** grep-match
**Command:** `grep -rc "getPrincipal" src/app/api/chat/route.ts src/app/api/chat/history/route.ts src/app/api/auth/me/route.ts`
**Expected:** Each file ≥ 1
**Fail if:** Any file returns 0 — route does not derive identity from the verified session

### Contract for Task 4 — auth/me endpoint exists
**Check type:** file-exists
**Command:** `test -f src/app/api/auth/me/route.ts && echo EXISTS`
**Expected:** `EXISTS`
**Fail if:** File does not exist — the client cannot learn its own session identity

### Contract for Phase — unauthenticated chat is rejected (behavioral)
**Check type:** behavioral
**Command:** (verifier, dev server running) `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"hi"}]}'`
**Expected:** `401`
**Fail if:** Returns 200 or streams a reply — an unauthenticated caller can still drive the agent

### Contract for Phase — cross-principal history isolation (behavioral)
**Check type:** behavioral
**Command:** (verifier) Log in as Wency, capture the `aq_session` cookie, then `GET /api/chat/history?principal=Jeanette&view=sessions` with Wency's cookie.
**Expected:** Returns only Wency's sessions (the `principal` query param is ignored)
**Fail if:** Returns Jeanette's sessions — query-param principal still trusted
