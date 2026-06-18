# Aquavoy E2E (Playwright)

Browser-level end-to-end tests. Complements the vitest seam suite (`npm test`,
`src/**/*.test.ts`) — vitest mocks the adapters; these drive a real browser
against a running app.

## Layout

| Spec | Covers | Secrets needed |
|------|--------|----------------|
| `auth-gate.spec.ts` | Trust boundary — redirects, `/api/*` 401s, health 200, login render + bad-credential reject (REQ-1/2/20) | **None** — runs anywhere, incl. prod |
| `authenticated.spec.ts` | Authed surface loads + management pages at 375px (REQ-2/17/18) | `SESSION_SECRET` (mints a session cookie; no live integration keys) |
| `deep-flows.spec.ts` | Chat → tool trace, confirm/undo, IMAP send, OneDrive (REQ-9/10/11/13/16) | **Live** LLM + mailbox + Graph creds — opt-in only |

## Run

```bash
# Full suite against a locally-booted `next dev` (auto-started/stopped).
# Needs .env.local + .env.development.local present (real SESSION_SECRET there).
npm run test:e2e

# Auth-gate only, against live production (no server, no secrets):
npm run test:e2e:prod
#   → E2E_BASE_URL=https://aquavoy.vercel.app playwright test e2e/auth-gate.spec.ts

# Opt into the live agent flows (requires a configured environment):
E2E_LIVE_AGENT=1 npm run test:e2e -- e2e/deep-flows.spec.ts
```

`E2E_BASE_URL` switches target: unset → local `next dev`; set → that URL, no
local server. The session helper reads `SESSION_SECRET` from the env files and
never writes or logs the value.

## What stays operator-only

`deep-flows.spec.ts` exercises side-effecting integrations (sending real company
mail, OneDrive OAuth, the live LLM loop). Per `docs/qa-checklist.md`, those are
run by the operator on production with live credentials — the suite ships the
specs (real selectors) but skips them unless `E2E_LIVE_AGENT=1`.
