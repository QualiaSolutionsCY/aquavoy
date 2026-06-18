# Phase 2 Scout — Mail Stack Recon (pre-ADR-004)

> Read-only reconnaissance gathered during M3-P1 planning (parallel scout). Ground truth for the `/qualia-scope 2` session and ADR-004. All claims carry file:line citations.

## TL;DR

Two **non-overlapping** mail stacks exist. There is **no dual-send code path** today — the REQ-16 "silent fallback" risk is *architectural*, not a live bug: nothing in `mail_accounts` records which stack owns a mailbox.

- **IMAP/SMTP** (`src/lib/mail/*`) — authoritative for the **12 company mailboxes** (aquavoy.com ×7, faialbv.com ×5, hardcoded `mailboxes.ts:31-47`). Read/send/search/folders + the scheduled-send queue. The agent has **8 tools** routing here (`onedriveTools.ts:278-465`).
- **Graph/Outlook** (`src/lib/microsoft/outlook.ts`) — send/draft/list-inbox for the **authenticated user's personal Outlook only** (delegated OAuth). **No agent tool** reaches it; it's UI-only via the prep page. Cannot serve company mailboxes.

## Routes inventory

| Endpoint | Stack | Note |
|---|---|---|
| `/api/mail/accounts` | IMAP/SMTP | list/create/delete accounts; verifies SMTP before persist |
| `/api/mail/send` | IMAP/SMTP | send from stored account (`smtp.ts:59`) |
| `/api/mail/scheduled` (+ `/run`) | IMAP/SMTP | queue in `scheduled_emails`; cron drains via SMTP (`scheduled.ts:154-203`) |
| `/api/outlook/draft` | **none** | pure LLM drafting (`agents/draftEmail.ts`) — no MS creds |
| `/api/outlook/send` | Graph/Outlook | requires `connectionId`; user-personal only |

## DB / orphan analysis

- `mail_accounts` (migration `0003`) — IMAP/SMTP creds, encrypted `password`. `scheduled_emails` (`0007`) refs `from_email` (soft, no FK); `scheduled.ts:74-79` validates the account exists before queueing.
- `onedrive_connections` (migration `0001`) — Graph OAuth tokens; also powers OneDrive file browsing (NOT just Outlook).
- **Drop IMAP/SMTP** → remove `mail_accounts` + `scheduled_emails` (migrations 0003/0005/0007), 8 agent tools, `/api/mail/*`, Emails page. **High cost — kills company mail.**
- **Drop Outlook** → remove `/api/outlook/send` + `outlook.ts`. **Low cost** *only if* OneDrive stays (Graph OAuth is shared with file browsing).

## Recommended ADR-004 direction (for scope to confirm/override)

1. **Keep both, declare roles:** IMAP/SMTP = authoritative for company operations; Outlook = user-personal drafting/send only (no scheduled send, no company mailbox access).
2. **REQ-16:** add a `mail_stack` enum (`'imap'|'outlook'`, default `'imap'`) to `mail_accounts`; the `send_email` agent tool asserts `'imap'` and raises a human-readable error otherwise — no silent fallback.
3. **Boundary doc:** `/api/outlook/draft` = drafting only (no creds); `/api/outlook/send` = user OAuth, out-of-scope for company mail.
4. **Code markers:** annotate each send path `// ADR-004: authoritative stack for this operation`.

*This is the scout's read, not a locked decision. `/qualia-scope 2` grills it before ADR-004 is written.*
