# Aquavoy — Final QA Checklist (M4 Handoff · REQ-21)

## How to use this checklist

The **OPERATOR runs the live flows on production** and fills in the `Status`,
`Tester`, and `Date` columns. This build/CI environment **cannot execute these
flows**: the app is auth-gated (ADR-001) and every headline flow depends on live
API keys (mail IMAP/SMTP credentials, Microsoft Graph / OneDrive OAuth, the LLM
provider behind the agent loop). Running them here would require fabricating a
session and live secrets.

The **`Code-evidence`** column is therefore the load-bearing artifact for this
build: it cites the exact `file:line` (or archived per-phase verification) that
proves the code-level invariant behind each flow is already in place and was
verified during M1–M3. The operator confirms the *runtime* behavior on prod; the
code-evidence confirms the *implementation* is what the flow assumes.

`Status` / `Tester` / `Date` cells are intentionally left as **☐ pending
operator** — they are filled only after a real production run. Do not pre-fill
them; an empty cell is the honest state until the operator signs off.

Legend — Status values the operator may enter: `PASS` · `FAIL` · `N/A`.

---

## 1. Auth gate (ADR-001)

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| Protected page redirects | Hit a protected page route (e.g. `/`) with no session cookie | Browser redirects to `/login` | `src/proxy.ts:38` — `return NextResponse.redirect(new URL("/login", request.url))` (page branch after auth check at `:30`) | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Protected API rejects | Hit a protected `/api/*` route with no session | `401` JSON envelope `{ ok: false, error: "Unauthorized" }`, handler never runs | `src/proxy.ts:34-35` — `if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })` | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Health probe unauthed | `GET /api/health` with no session | `200` (liveness probe, no secrets/DB/auth) | `src/proxy.ts:21` — `ALLOWLIST` set includes `"/api/health"` (allowlist short-circuits at `:26-27`) | ☐ pending operator | ☐ pending operator | ☐ pending operator |

## 2. Agent chat + tool trace

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| Reply streams | Log in, send a message that triggers ≥1 tool call | Assistant reply streams into the bubble | `src/app/page.tsx:114` — `traceOpen` disclosure state mirrors the streaming bubble render | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Trace row shows tools/provider/latency | After the reply lands, read the trace disclosure row under the bubble | Row shows tool count, provider/model, and latency in seconds | `src/app/page.tsx:617,621-625` — `className="trace-row"` with `aria-label` composing `toolCount`, `friendlyModel(trace.provider, trace.model)`, and `(trace.latencyMs / 1000).toFixed(1)` | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Trace expands | Click the trace row | Per-tool panel expands (`aria-expanded` toggles); fetched via the trace endpoint | `src/app/page.tsx:618` — `onClick={() => toggleTrace(i)}`; endpoint `src/app/api/traces/[id]/route.ts` | ☐ pending operator | ☐ pending operator | ☐ pending operator |

## 3. Confirm / Undo a destructive action (ADR-003)

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| Action is staged, never auto-run | Ask the agent to send an email or delete a file | A pending-action card appears; the side-effect does NOT auto-execute from the model loop | `src/lib/agents/executeConfirmedAction.ts:11-16` — comment: "the ONLY place the actual mutation happens — `executeTool` never calls these. The confirm endpoint … is the sole caller, after a human has confirmed the staged `pending_actions` row (ADR-003 §3)"; `src/app/page.tsx:125-127` — `pending` state cards | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Confirm executes | Click Confirm on the pending card | The real side-effect runs once | `src/lib/agents/executeConfirmedAction.ts:33` — `export async function executeConfirmedAction(...)` (sole mutation entry, called by confirm endpoint) | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Undo reverses where reversible | After a reversible action (move/rename/schedule), click Undo | Action reverses; irreversible actions (send_email) expose no undo | `src/lib/agents/executeConfirmedAction.ts:55-58,72-75,159` — `undo_data` populated for move/rename/schedule; `:119-120` — `send is irreversible — no undo_data` | ☐ pending operator | ☐ pending operator | ☐ pending operator |

## 4. Mail send + schedule via IMAP stack (ADR-004 / REQ-16)

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| Send from IMAP mailbox | Confirm a `send_email` from a company IMAP mailbox | Mail sends via SMTP; result `{ sent: true }` | `src/lib/agents/executeConfirmedAction.ts:116-121` — `await sendMail({ account, to, subject, body })` then `result: { sent: true, ... }` | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Outlook-stack mailbox rejected | Attempt to send from a mailbox whose `mailStack` is not `imap` | Human-readable error; no silent cross-stack fallback | `src/lib/agents/executeConfirmedAction.ts:110-114` — `if (account.mailStack !== "imap") throw new Error(... "owned by the ${account.mailStack} stack; the agent only sends company mail through IMAP/SMTP. No silent fallback (ADR-004 / REQ-16)")` | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Scheduled email drains via cron | Schedule an email for the near future; wait for the cron tick | Queued row sends at its scheduled time | `vercel.json:3-5` — cron `path: "/api/mail/scheduled/run"`, `schedule: "* * * * *"`; same `mailStack` guard at `src/lib/mail/scheduled.ts:83-85` | ☐ pending operator | ☐ pending operator | ☐ pending operator |

## 5. OneDrive file ops

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| List a folder | Ask the agent (or use the Files page) to list a OneDrive folder | Folder contents return | `src/app/api/onedrive/files/route.ts` (and `src/app/api/onedrive/folder/route.ts`) | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Download a file | Download a listed file | File bytes/stream return | `src/app/api/onedrive/download/route.ts` | ☐ pending operator | ☐ pending operator | ☐ pending operator |

## 6. Management pages at 375px (mobile)

Archived runtime baseline: `.planning/archive/milestone-3-operations-polish/phase-3-verification.md`
— machine contract **13/13 PASS** (grep-match contracts; live 375px browser check is the operator's job here).

| Flow | Steps | Expected | Code-evidence | Status | Tester | Date |
|------|-------|----------|---------------|--------|--------|------|
| Skeleton on slow load | At 375px, open Emails / Files / Prep on a throttled connection | Skeleton placeholder shows while loading | `.planning/archive/milestone-3-operations-polish/phase-3-verification.md` — loading/skeleton contracts in the 13/13 PASS set | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Inline error + retry | Force a fetch failure | Inline error with a retry affordance (not a blank screen) | `.planning/archive/milestone-3-operations-polish/phase-3-verification.md` — error+retry contracts in the 13/13 PASS set | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Empty-state CTA | Open a page with no data | Empty-state with an actionable CTA | `.planning/archive/milestone-3-operations-polish/phase-3-verification.md` — `empty-hint count ≥ 1` PASS | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| No horizontal overflow + 44px targets | Scroll each page at 375px; tap interactive controls | No horizontal scroll; tap targets ≥ 44px | `.planning/archive/milestone-3-operations-polish/phase-3-verification.md` — `btn.danger:not(.sm) → min-height: 44px` PASS, `min-height: 28px count = 0` PASS | ☐ pending operator | ☐ pending operator | ☐ pending operator |
| Prep ✕ stays corner-pinned | Open the Prep panel at 375px | The close ✕ stays pinned to the top-right corner | `src/app/globals.css:331-335` — `.btn.close { position: absolute; top: var(--sp-2); right: var(--sp-2); ... }` | ☐ pending operator | ☐ pending operator | ☐ pending operator |
