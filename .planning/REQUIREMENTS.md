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

## M2 — Agent Depth *(sketched — REQ-IDs assigned when milestone opens)*

- Richer memory: conversation summarization / semantic recall beyond keyword grep
- Inline document understanding (read + summarize a drive file within a turn)
- Stronger confirm / undo affordances for destructive tool calls

## M3 — Operations Polish *(sketched)*

- Observability: log model + tool-call traces; surface which provider answered
- Two-mail-stack decision (Graph/Outlook vs IMAP/SMTP)
- UX refinement across Emails / Files / Prep

## M4 — Handoff *(standard)*

- Documentation, deployment hardening + monitoring, knowledge transfer, acceptance
