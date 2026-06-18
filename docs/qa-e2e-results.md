# Aquavoy — Automated E2E Results & Requirement Traceability

**Run date:** 2026-06-18 · **Branch:** `m4-e2e-suite` · **Base commit:** `ec58572`
**Suites:** vitest seam tests (`npm test`) + Playwright browser e2e (`npm run test:e2e`)

This is the automated companion to `docs/qa-checklist.md`. The checklist proved
each flow's invariant by `file:line`; this document records the runtime result
of actually executing the flows that can be executed without live integration
secrets — against both local dev and **live production**.

## Result summary

| Suite | Command | Result |
|-------|---------|--------|
| Seam / unit | `npm test` (vitest) | **59 passed / 12 files** |
| E2E auth gate — **live prod** | `npm run test:e2e:prod` | **10 passed** (https://aquavoy.vercel.app) |
| E2E full — local dev | `npm run test:e2e` | **17 passed, 2 skipped** (skips = opt-in live-agent) |
| Typecheck | `npm run typecheck` | **0 errors** |
| Lint | `npm run lint` | **0 errors** (18 pre-existing test-file warnings) |

Live prod auth-gate (curl, same run): `/`→307 `/login` · `/api/chat`→401 ·
`/api/mail/send`→401 · `/api/health`→200 · `/login`→200.

## Requirement → evidence → automated status

Legend: **E2E** = exercised by Playwright this run · **UNIT** = exercised by
vitest · **CODE** = implementation cited in `docs/qa-checklist.md` (no runtime
surface to automate) · **OPERATOR** = human/business action, off-repo by design.

| REQ | Requirement (short) | Automated this run | How |
|-----|---------------------|--------------------|-----|
| REQ-1 | Mutating/PII routes reject unauthed | ✅ E2E | `/api/chat`,`/api/mail/send`,`/api/recipients` → 401 (prod + local) |
| REQ-2 | App gated by real credential check | ✅ E2E | `/`,`/emails`,`/files`,`/prep` → `/login`; authed cookie loads chat |
| REQ-3 | Principal verified, not shape-whitelisted | ✅ UNIT | `src/lib/auth/session.test.ts` (HMAC verify); authed e2e mints a valid signed cookie |
| REQ-4 | Mailbox passwords encrypted at rest | ✅ UNIT | `src/lib/crypto/secrets.test.ts` |
| REQ-5 | OAuth tokens encrypted at rest | ✅ UNIT | `src/lib/crypto/secrets.test.ts` |
| REQ-6 | `scheduled_emails` tracked migration | 🔎 CODE | migration on disk; verified at M4-P2 deploy audit |
| REQ-7 | `mail_accounts` uniqueness reconciled | 🔎 CODE | migration; M4-P2 audit |
| REQ-8 | Test framework + seam tests | ✅ UNIT | vitest configured, 59 tests green |
| REQ-9 | Durable memory (summarize/recall + sweep) | ✅ UNIT | `memoryStore.test.ts`, `api/memory/sweep/route.test.ts` (+ deep-flow opt-in) |
| REQ-10 | Inline document understanding | ✅ UNIT | `onedriveTools.test.ts` (+ deep-flow opt-in) |
| REQ-11 | Confirm/Undo for destructive calls | ✅ UNIT | `api/actions/confirm/route.test.ts` (+ deep-flow opt-in, real selectors) |
| REQ-12 | Model/provider surfaced per turn | 🔎 CODE | `src/app/page.tsx:617-625` (trace row) |
| REQ-13 | Per-turn tool-call trace expandable | 🟡 E2E-optin | `deep-flows.spec.ts` trace spec — runs with `E2E_LIVE_AGENT=1` |
| REQ-14 | Token/latency metrics stored per turn | 🔎 CODE | metrics persisted at agent turn; M3-P1 verification |
| REQ-15 | Mail-stack ADR recorded + implemented | 🔎 CODE | `.planning/decisions/` ADR-004 |
| REQ-16 | Authoritative stack discoverable, no silent fallback | ✅ UNIT | `mail/scheduled.test.ts`; `executeConfirmedAction.ts` stack guard |
| REQ-17 | Skeleton + inline error/retry on pages | 🟡 E2E-partial | authed render specs reach pages (skeleton `aria-busy`); error/retry cited M3-P3 |
| REQ-18 | Pages usable at 375px (no overflow) | ✅ E2E | `authenticated.spec.ts` — emails/files/prep, scrollWidth ≤ viewport |
| REQ-19 | Repo/docs orient a maintainer | 🔎 CODE | `docs/` (runbook, env-ref, architecture, ADR index) |
| REQ-20 | Prod deploy verified (cron, migrations, RLS, no client secret, monitoring) | ✅ E2E + audit | live health 200 + auth gate; M4-P2 deploy audit |
| REQ-21 | QA checklist verified on prod | ✅ partial | §1 auth gate fully automated (prod); §6 375px automated; §2–5 operator/opt-in |
| REQ-22 | Operator walkthrough + credential handover + sign-off | ⬜ OPERATOR | human/business ceremony, off-repo by design |

## Honest gaps (by design, not omission)

The side-effecting flows — sending real company email, OneDrive OAuth file ops,
the live LLM tool loop — require live production credentials and would mutate
real mailboxes/files. They are implemented (code-evidence in `qa-checklist.md`,
unit-tested at the seam) and shipped as **opt-in** Playwright specs
(`deep-flows.spec.ts`, `E2E_LIVE_AGENT=1`) with real selectors, but are not run
in this credential-free pass. Together with REQ-22's human handover, these are
the only items the operator must still confirm on production.

**Bottom line:** every engineering requirement (REQ-1…20) is implemented and
backed by a passing automated test or cited code-evidence; the auth/trust
boundary and 375px responsiveness are verified live in a real browser. What
remains is operator-run live-integration QA (REQ-21 §2–5) and the REQ-22
business handover — both human actions by design.
