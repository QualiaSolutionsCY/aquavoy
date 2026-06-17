# REQUIREMENTS — Aquavoy

> Multi-milestone, REQ-ID tracked. VAL-* are already shipped (see PROJECT.md). REQ-* are this journey's active work. Proposed — pending approval.

## M1 — Trust & Hardening ✓ COMPLETE (shipped 2026-06-15 → https://aquavoy.vercel.app)

All REQ-1…8 verified and live. See `.planning/archive/milestone-1-trust-and-hardening/`.

| ID | Requirement | Maps to concern | Phase |
|---|---|---|---|
| REQ-1 | Every mutating/PII API route rejects unauthenticated callers (chat, mail send, outlook send, onedrive write, recipients, chat/history) | HIGH-1 | 1 |
| REQ-2 | App access is gated by a real credential check, not a loading splash | HIGH-1 | 1 |
| REQ-3 | A caller's principal is verified, not just shape-whitelisted; one principal cannot read another's history | MED-1 | 1 |
| REQ-4 | Mailbox passwords encrypted at rest; decrypted only server-side at send/IMAP time | HIGH-2 | 2 |
| REQ-5 | OAuth access/refresh tokens encrypted at rest | HIGH-2 | 2 |
| REQ-6 | `scheduled_emails` table exists as a tracked migration matching live schema | migration drift | 3 |
| REQ-7 | `mail_accounts` email-uniqueness constraints reconciled to one source of truth | MED-3 | 3 |
| REQ-8 | Test framework configured; seam tests for Graph/IMAP/SMTP adapters + route-level auth/tool-dispatch | HIGH-3 | 3 |

## M2 — Agent Depth ✓ COMPLETE (shipped 2026-06-17 → https://aquavoy.vercel.app)

All REQ-9…11 verified and live. See `.planning/archive/milestone-2-agent-depth/`.

| ID | Requirement | Phase |
|---|---|---|
| REQ-9 | Durable memory: conversation summarization / semantic recall beyond keyword grep, with a server-side memory store and sweep | 1 |
| REQ-10 | Inline document understanding — read + summarize a drive file within a single agent turn | 2 |
| REQ-11 | Confirm/Undo affordances for destructive tool calls — pending-action staging, human Confirm/Cancel/Undo, scheduled-email isolation | 3 |

## M3 — Operations Polish ✓ COMPLETE (verified 2026-06-17)

All REQ-12…18 verified and live. See `.planning/archive/milestone-3-operations-polish/`.

| ID | Requirement | Source | Phase |
|---|---|---|---|
| REQ-12 | Operator can see which model and provider answered each agent turn — surfaced in the chat UI per response | JOURNEY.md §M3 — observability | 1 |
| REQ-13 | Operator can expand a per-turn tool-call trace showing tool name, argument summary, result summary, and latency — no network tab required | JOURNEY.md §M3 — observability | 1 |
| REQ-14 | Token-usage and latency metrics are stored per agent turn in the database and are queryable (model, provider, tool_calls JSONB, latency_ms, prompt_tokens, completion_tokens) | JOURNEY.md §M3 — observability | 1 |
| REQ-15 | The mail architecture decision (dual-stack vs converge) is recorded as an ADR in `.planning/decisions/` with rationale and the chosen path implemented in code | JOURNEY.md §M3 — two-mail-stack decision | 2 |
| REQ-16 | Whichever stack is authoritative for each mailbox is discoverable at runtime — no silent fallback from one stack to the other; errors surface a human-readable message to the operator | JOURNEY.md §M3 — two-mail-stack decision | 2 |
| REQ-17 | Emails / Files / Prep pages each show a skeleton loader while data is in-flight and an inline error with retry on fetch failure — no blank screen or unhandled JS error | JOURNEY.md §M3 — UX refinement | 3 |
| REQ-18 | All three management pages are usable at 375 px viewport width: no horizontal overflow, tap targets ≥ 44 px, readable type, and a non-empty empty state on each page | JOURNEY.md §M3 — UX refinement | 3 |

## M4 — Handoff `[CURRENT]`

| ID | Requirement | Source | Phase |
|---|---|---|---|
| REQ-19 | A maintainer or operator can orient from the repo and docs alone: README covers local dev + page map; operator runbook covers the confirm/undo flow, the 12 mailboxes, and the OneDrive connection; env-var reference lists every variable; ADR index links ADR-001 through ADR-004 | JOURNEY.md §M4 — documentation pass | 1 |
| REQ-20 | Production deployment is verified and documented: Vercel cron fires on schedule, all 12 migrations (0001–0012) are applied to prod with no schema drift, RLS is confirmed on every table, no secret (`service_role`, mail creds, API keys) is reachable from client code, and a monitoring approach is documented | JOURNEY.md §M4 — deployment hardening + monitoring | 2 |
| REQ-21 | A QA checklist is produced and all items verified pass on production: auth gate, agent chat with tool trace, confirm/undo a destructive action, send/schedule mail via the IMAP stack, OneDrive file ops (list + download), and all three management pages at 375 px — checklist committed to repo with tester name and date per row | JOURNEY.md §M4 — final QA | 3 |
| REQ-22 | Operator walkthrough delivered to Wency and Jeanette; credential handover checklist completed (Supabase, Vercel, Microsoft app registration, 12 mailbox creds, OpenRouter/Gemini/Tavily keys); client has independent Vercel deploy access; written acceptance sign-off obtained tying back to M1–M3 exit criteria; Qualia developer access removed or downgraded after handover | JOURNEY.md §M4 — knowledge transfer + acceptance | 4 |
