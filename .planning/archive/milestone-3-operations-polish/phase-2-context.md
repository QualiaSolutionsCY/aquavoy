# Phase 2 Context — Mail Stack Decision

> Decision locked autonomously during a full-auto run (operator away), grounded in `.planning/phase-2-scout.md` (read-only recon with file:line citations). The non-destructive path was chosen deliberately: an agent does not delete working, shipped code (a 12-mailbox IMAP fleet) without human sign-off.

## Locked Decisions

| ID | Decision | Rationale (cited) |
|---|---|---|
| D-01 | **Keep both mail stacks** — do NOT converge/delete either. | Dropping IMAP/SMTP kills all 12 company mailboxes (`mailboxes.ts:31-47`, VAL-5) — critical, high-cost. Dropping Outlook is low-cost but Graph OAuth is shared with OneDrive file browsing. Neither deletion is safe to do autonomously. |
| D-02 | **IMAP/SMTP is the authoritative stack for company mailboxes** (aquavoy.com / faialbv.com); Outlook (`microsoft/outlook.ts`) is user-personal drafting/send only — no agent tool, no company mailbox access. | Scout: agent has 8 IMAP/SMTP tools, 0 Outlook tools (`onedriveTools.ts:278-465`); Outlook reachable only via the prep UI. |
| D-03 | **Record the decision as `.planning/decisions/ADR-004-mail-stack.md`** (dated, names chosen path = keep-both, ties rationale to VAL-4/VAL-5). | REQ-15. |
| D-04 | **REQ-16 (no silent fallback):** add a `mail_stack` discriminator (`'imap' \| 'outlook'`, default `'imap'`) to `mail_accounts` via a tracked migration; the agent `send_email` path asserts the account's stack is `'imap'` and returns a human-readable error otherwise — no implicit cross-stack fallback. Each mail send/read path gets an `// ADR-004: authoritative stack` ownership comment. | REQ-16; scout found the risk is architectural (no runtime discriminator), not a live dual-send bug. |
| D-05 | **No code deletion in this phase.** Migrations are additive only. | Constitution: schema changes are additive tracked migrations; destructive convergence would need explicit human approval. |

## Deferred Ideas (out of scope for this phase)
- Converging to a single stack (either direction) — revisit only with explicit operator decision; not an auto call.
- App-only client-credentials Graph model for company mailboxes (PROJECT.md "Out of Scope").
