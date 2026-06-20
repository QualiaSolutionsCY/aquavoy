# Phase 2 Plan · M5 Email Intelligence

**Milestone:** 5 — Client Meeting Build
**Phase:** 2 of 4 — Email Intelligence (A4 + A5)
**Goal:** Wency can read his inbox in the app (not just via the agent), and the agent can
brief him — counts, important emails to read, likely spam/ads to skip.

## Task 1 — Mail read API
`GET /api/mail/messages` (list a folder) + `GET /api/mail/message` (read one by uid),
read-only over IMAP, principal-gated, mailbox validated against `MAILBOXES`.
**Done when:** both endpoints return the contract shape and 401/400 on bad input.

## Task 2 — Emails reader UI
Inbox reader on the Emails tab: mailbox selector, left email list, click-to-read detail.
**Done when:** select → list → click → read works with loading/empty/error states, no regression to connect/scheduled panels.

## Task 3 — Inbox briefing
`src/lib/mail/briefing.ts` `generateInboxBriefing()` — fetch recent mail, LLM-classify
important/routine/spam, defensive JSON parse, structured result.
**Done when:** returns `{mailbox,total,important,likelySpam,summary}`; malformed LLM output degrades, never throws.

## Task 4 — Briefing agent tool
`generate_inbox_briefing` read-only tool in `onedriveTools.ts` (NOT in DESTRUCTIVE set),
identity pinned to the verified principal.
**Done when:** the agent can produce a briefing on request; tool runs without a confirm card.

## Acceptance Criteria
- Reader + briefing work end-to-end; existing panels intact.
- `tsc --noEmit` clean; full unit suite green (87/87).

Detailed source: `.planning/m5-phase1-scope.md` (Phase 2 section).
