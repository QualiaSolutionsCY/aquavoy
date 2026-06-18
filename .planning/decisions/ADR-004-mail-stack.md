# ADR-004 — Keep Both Mail Stacks, One Owner Per Operation (M3 · Phase 2)

**Date:** 2026-06-17
**Phase:** 2 — Mail Stack Decision
**Status:** Accepted
**Deciders:** Moayad (EMPLOYEE) — locked autonomously during a full-auto run (operator away); OWNER ratification on first ship
**Domain terms:** `mail_stack` (discriminator: `'imap' | 'outlook'`), company mailbox, user-personal mailbox
**Touches:** `src/lib/mailboxes.ts`, `src/lib/mail/*`, `src/lib/microsoft/outlook.ts`, `src/lib/agents/onedriveTools.ts`, `mail_accounts` (migration — Task 2)

## Context

We keep both mail stacks and declare a single owner per operation: IMAP/SMTP for company mailboxes, Outlook for user-personal mail only.

Two **non-overlapping** mail stacks exist in the codebase and neither can be deleted autonomously:

- **IMAP/SMTP** (`src/lib/mail/*`) is authoritative for the **12 hardcoded company mailboxes** —
  7 on aquavoy.com and 5 on faialbv.com (`src/lib/mailboxes.ts:31-47`, **VAL-5**). It owns
  read/send/search/folders and the scheduled-send queue, and the agent reaches it through 8 tools
  (`src/lib/agents/onedriveTools.ts:278-465`). Dropping it kills all company mail — critical,
  high-cost, not an autonomous call.
- **Graph/Outlook** (`src/lib/microsoft/outlook.ts`, **VAL-4**) is delegated OAuth for the
  **authenticated user's personal Outlook only**. **No agent tool reaches it** — it is UI-only via
  the prep page. It cannot serve company mailboxes. Dropping it is low-cost *only if* OneDrive stays,
  because the same Graph OAuth (`onedrive_connections`, migration `0001`) also powers OneDrive file
  browsing — so deleting Outlook tangles with an unrelated, shipped feature.

REQ-15 / D-03 require this dual-stack call to be recorded as a dated ADR naming the chosen path and
tying rationale to VAL-4 (Graph delegated OAuth) and VAL-5 (the 12-company-mailbox IMAP fleet). The
underlying risk REQ-16 names — a silent cross-stack fallback — is **architectural, not a live bug**:
the scout found nothing in `mail_accounts` records which stack owns a mailbox, so there is no runtime
discriminator to enforce the boundary (`.planning/phase-2-scout.md`).

## Decision

**Keep both mail stacks — do NOT converge or delete either — and declare a single authoritative
owner per operation.**

1. **IMAP/SMTP = authoritative for company mailboxes** (aquavoy.com / faialbv.com). All company
   read/send/search/folders/scheduled-send routes through this stack and only this stack.
2. **Outlook = user-personal drafting/send only.** No agent tool, no company-mailbox access. It is
   reachable solely through the prep UI under the authenticated user's own delegated OAuth.
3. **REQ-16 boundary is enforced structurally, not by prose.** A `mail_stack` discriminator column
   (`'imap' | 'outlook'`, default `'imap'`) is added to `mail_accounts` via a tracked additive
   migration (Task 2). The agent `send_email` / `schedule_email` path asserts the account's stack is
   `'imap'` and returns a human-readable error otherwise — no implicit cross-stack fallback (Task 3).
4. **No code deletion in this phase.** Migrations are additive only; destructive convergence would
   require explicit human approval (Constitution: schema changes are additive tracked migrations).

## Alternatives considered

- **Converge to Graph/Outlook (delete IMAP/SMTP).** Rejected — kills all 12 company mailboxes
  (`src/lib/mailboxes.ts:31-47`, VAL-5) and the scheduled-send queue. Graph delegated OAuth (VAL-4)
  serves only the authenticated user's personal mailbox; it cannot stand in for shared company
  addresses. High-cost, autonomously unsafe.
- **Converge to IMAP/SMTP (delete Outlook).** Rejected — low cost *only if* OneDrive stays, but the
  Graph OAuth that Outlook rides on is **shared with OneDrive file browsing** (`onedrive_connections`,
  migration `0001`). Removing Outlook risks the OneDrive feature, so even the "cheap" deletion is not
  cleanly isolated. Not worth the blast radius this phase.
- **App-only client-credentials Graph model for company mailboxes.** Rejected — out of scope per
  PROJECT.md; would be a separate, larger decision.

## Consequences

- **What becomes easier:** every send/read path has one named owner, so future readers (and the
  agent) never guess which stack handles a mailbox. The `// ADR-004: authoritative stack` ownership
  comments on each path make the boundary self-documenting.
- **What becomes harder:** two stacks remain in the tree, so mail logic is not unified — a future
  convergence (either direction) is deferred, not solved, and must be revisited with explicit
  operator sign-off.
- **What is now load-bearing on this decision:** REQ-16 (no silent fallback) is enforced by the
  `mail_stack` discriminator column added in Task 2 **plus** the agent send/schedule stack assertion
  added in Task 3. If either is removed, the architectural cross-stack-fallback risk returns.

## Notes

This decision was locked during a full-auto run with the operator away; the non-destructive path was
chosen deliberately because an agent does not delete working, shipped code (a 12-mailbox IMAP fleet)
without human sign-off. Grounded in `.planning/phase-2-scout.md` (read-only recon with file:line
citations) and `.planning/phase-2-context.md` (locked decisions D-01..D-05).
