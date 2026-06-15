# ADR-001 — Access-Control Strategy (Phase 1)

**Date:** 2026-06-15
**Status:** Accepted
**Deciders:** Fawzi (OWNER)

## Context

Aquavoy's API surface is fully unauthenticated (codebase map HIGH-1). `POST /api/chat` drives an agent that can send company email and delete/move OneDrive files; `chat/history` and `recipients` expose PII keyed only on an unverified `principal` query param. The app "gate" is a loading splash that auto-logs in as "Wency". This is acceptable only under an undocumented network-gating assumption. Phase 1 must close it.

The fork: how much auth machinery does a single-tenant, two-operator internal tool need?

## Decision

**App password + signed httpOnly session cookie carrying the verified principal.**

- `POST /api/login` verifies a per-operator password (Wency | Jeanette) and sets a signed, httpOnly, secure session cookie encoding the verified principal.
- `middleware.ts` guards every route except `/login`, the login API, and the `CRON_SECRET`-protected cron runner.
- API routes read the principal from the cookie, **not** from the request body / query param.
- `chat/history` and any PII read is scoped to the cookie's principal (satisfies REQ-3 — one principal cannot read another's history).

## Alternatives considered

- **Supabase Auth + per-principal RLS** — real `auth.uid()` sessions, `owner_id` columns + RLS on all 4 tables. Rejected for now: large blast radius (migrations on every table, rewire all service-role reads to user-scoped) for isolation value that the cookie-principal approach already delivers at two-operator scale. The migration comments anticipate this path; it remains the documented upgrade if the tenant model ever grows.
- **Vercel deployment protection + single shared gate** — lightest, but a shared credential cannot satisfy REQ-3 (per-principal isolation). Rejected: leaves the isolation requirement unmet.

## Consequences

- New: `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`, Node runtime by default — confirmed during planning; ADR substance unchanged, only the filename convention), `POST /api/login`, a session-signing util (HMAC over an env secret, e.g. `SESSION_SECRET`), a login page.
- Changed: every API route stops trusting `principal` from input; reads it from the session. `app/page.tsx` gate replaced with real login.
- Env: add `SESSION_SECRET` and per-operator password hashes (or a credentials map) — server-only.
- Reversible-ish: swapping to Supabase Auth later is a contained migration; the route-level "get principal from session" seam stays the same.
