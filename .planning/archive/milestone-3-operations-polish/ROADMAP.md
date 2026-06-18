# Roadmap · Milestone 3 · Operations Polish

**Project:** Aquavoy
**Milestone:** 3 of 4 (CURRENT)
**Created:** 2026-06-17
**Phases:** 3
**Requirements covered:** REQ-12, REQ-13, REQ-14, REQ-15, REQ-16, REQ-17, REQ-18

See `JOURNEY.md` for the full project arc. This file is ONLY the current milestone's phases.

## Exit Criteria

What "shipped" means for this milestone:

- Every agent turn persists a structured trace (model, provider, tool calls, latency, token counts) readable from the database; operators can see which tools ran and who answered without opening the network tab.
- The two-mail-stack question is resolved: either the dual stack is formally documented as an intentional two-owner architecture with a clear adapter contract per stack, or one stack is removed — decision recorded in `.planning/decisions/ADR-004-mail-stack.md`.
- Emails, Files, and Prep pages have full loading / error / empty states and pass a mobile layout check at 375 px; no blank screen on slow network or failed fetch.

---

## Phases

| # | Phase | Goal | Requirements | Status |
|---|-------|------|--------------|--------|
| 1 | Observability | Instrument the agent loop and surface structured per-turn traces | REQ-12, REQ-13, REQ-14 | ready |
| 2 | Mail Stack Decision | Audit the dual stack, decide keep-both vs converge, implement the outcome | REQ-15, REQ-16 | — |
| 3 | UX Refinement | Polish Emails / Files / Prep with complete UI states and mobile layout | REQ-17, REQ-18 | — |

## Phase Details

### Phase 1: Observability

**Goal:** Every agent turn writes a structured trace record to the database (model chosen, provider that answered, all tool calls with names / args / result shape, latency per call, total token counts); the chat UI surfaces a collapsible "what ran" panel for each response.

**Requirements covered:**
- REQ-12: Operator can see which model and provider answered each agent turn
- REQ-13: Operator can expand a per-turn tool-call trace (tool name, arguments, result summary, latency)
- REQ-14: Token-usage and latency metrics are stored per turn and queryable from the database

**Success criteria** (observable behaviors):
1. After any agent response, the chat shows a disclosure row (e.g. "3 tools · Gemini Flash · 1.2 s") that expands to a per-tool trace with name, argument summary, and latency — no network tab or log-tailing required.
2. The `agent_traces` table (or equivalent) in Supabase has one row per turn with `model`, `provider`, `tool_calls` (JSONB array), `latency_ms`, `prompt_tokens`, and `completion_tokens` populated and non-null for every completed turn.
3. A slow or failed tool call is represented in the trace with its actual latency and an `error` field — the trace record is never silently omitted, even when the agent loop itself errors mid-turn.
4. The observability layer adds zero new runtime dependencies to the client bundle — all writes happen server-side inside the existing SSE route, not in a new background worker.

**Depends on:** M2 shipped (agent loop, confirm/undo, memory all stable).

---

### Phase 2: Mail Stack Decision

**Goal:** The dual-stack (Graph/Outlook for delegated-OAuth mail + IMAP/SMTP for the 12-mailbox fleet) is either formally documented as an intentional two-owner architecture with a single adapter contract per stack, or converged to one stack with the unused path removed and the rationale recorded as an ADR.

**Requirements covered:**
- REQ-15: The mail architecture decision (dual-stack vs converge) is recorded as an ADR in `.planning/decisions/` with rationale and the chosen path implemented
- REQ-16: Whichever stack is authoritative for each mailbox is discoverable at runtime — no silent fallback from one stack to the other; errors surface clearly to the operator

**Success criteria** (observable behaviors):
1. `.planning/decisions/ADR-004-mail-stack.md` exists, is dated, names the chosen path (keep-both / converge-to-Graph / converge-to-IMAP), and states the rationale tied to VAL-5 (12-mailbox IMAP fleet) and VAL-4 (Graph delegated OAuth for Wence/Jeanette mailboxes).
2. If keep-both: each adapter (`lib/mail/*` and `lib/microsoft/mail.ts`) has a clear ownership comment and a single exported interface per operation; no route calls both stacks for the same send/read operation.
3. If converge: the removed stack's code is deleted (not commented out), any orphaned config columns are dropped via a Supabase migration, and the surviving path is smoke-tested against a real mailbox in staging before merge.
4. The chat agent's mail tools return a consistent, human-readable error message regardless of which stack handles the call — operators see "Could not send from accounts@aquavoy.com" rather than a raw IMAP exception or a Graph SDK stack trace.

**Depends on:** Phase 1 (traces confirm which mail tool path actually fires in production before we remove one).

---

### Phase 3: UX Refinement

**Goal:** The Emails, Files, and Prep management pages have complete UI state coverage (loading skeleton, error boundary with retry, empty state with a call-to-action) and pass a basic mobile layout check at 375 px — operators on a phone or slow connection never see a blank or broken page.

**Requirements covered:**
- REQ-17: Emails / Files / Prep pages each show a skeleton loader while data is in-flight and an inline error with retry on fetch failure — no blank screen or unhandled JS error
- REQ-18: All three management pages are usable at 375 px viewport width (no horizontal overflow, tap targets ≥ 44 px, readable type)

**Success criteria** (observable behaviors):
1. On a throttled (Slow 3G) connection, each of the three pages shows a skeleton or placeholder immediately on load — visible in Chrome DevTools Network throttling before any data arrives.
2. When the backing API returns a 5xx error (simulated via DevTools or a temporary stub), the affected page section shows an inline "Could not load — Retry" message; no blank section, no unhandled JS error in the console.
3. At 375 px viewport width, no page content overflows horizontally — verified by setting `body { overflow: hidden }` at 375 px and confirming no horizontal scrollbar appears on any of the three pages.
4. All interactive elements on the three pages (buttons, links, input fields) have a minimum touch target area of 44 × 44 px at 375 px width — verified by inspecting computed height/width in DevTools.
5. Each page has a non-empty empty state: when no emails / files / prep recipients exist, a short prompt is shown ("Ask the agent to list your emails" / "Search for a file in the chat" / "Add a recipient to get started") rather than a blank container.

**Depends on:** Phase 2 (mail stack is stable before polishing the Emails page that renders from it).

---

## Coverage Verification

Every requirement in this milestone maps to exactly one phase.

| Requirement | Phase | Covered? |
|-------------|-------|----------|
| REQ-12 | Phase 1 | ✓ |
| REQ-13 | Phase 1 | ✓ |
| REQ-14 | Phase 1 | ✓ |
| REQ-15 | Phase 2 | ✓ |
| REQ-16 | Phase 2 | ✓ |
| REQ-17 | Phase 3 | ✓ |
| REQ-18 | Phase 3 | ✓ |

---

## When This Milestone Closes

Triggered by `/qualia-milestone` after `/qualia-verify` passes on Phase 3:

1. All phase artifacts are archived to `.planning/archive/milestone-3-operations-polish/`
2. `tracking.json` `milestones[]` gets a summary entry (num, name, phases_completed, shipped_url, closed_at)
3. REQUIREMENTS.md marks M3 requirements as **Complete**
4. M4 (Handoff) opens — roadmapper regenerates this ROADMAP.md for Milestone 4
5. `state.js init --force --milestone_name "Handoff"` resets current-phase fields, preserves lifetime + milestones[] history

---

*Last updated: 2026-06-17*
