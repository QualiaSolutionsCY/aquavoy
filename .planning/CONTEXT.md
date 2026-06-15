# CONTEXT — Aquavoy Domain Glossary

> Loaded by every road agent BEFORE PROJECT.md/DESIGN.md. Keep terse — one sentence per entry. Grown inline as decisions crystallize.

## Language

- **Aquavoy / Wence / Faial BV** — the same shipping entity; "Aquavoy" is the product/brand, "Faial BV" the legal entity, "Wence" the owner's shorthand. *Avoid:* treating them as separate clients.
- **Principal** — a named operator the chat scopes to (currently Wency or Jeanette); a whitelist for memory + persona, NOT authentication. *Avoid:* "user", "account", "login".
- **Agent** — the OpenRouter/Gemini tool-loop in `lib/openrouter/client.ts` that drives all 17 tools. *Avoid:* "bot", "assistant model".
- **Tool** — one capability in the registry (`onedriveTools.ts`), e.g. `send_email`, `delete_item`, `recall_memory`. *Avoid:* "function", "command".
- **Connection** — a stored Microsoft OneDrive OAuth account row (`onedrive_connections`), keyed by `ms_user_id`, auto-refreshing. *Avoid:* "integration", "account" (collides with Mail Account).
- **Mail Account** — a stored IMAP/SMTP mailbox credential row (`mail_accounts`) for one of the 12 company mailboxes. *Avoid:* "Connection" (that's OneDrive).
- **Mailbox** — one of 12 company addresses across aquavoy.com / faialbv.com defined in `mailboxes.ts`. *Avoid:* "inbox" (a folder within a mailbox).
- **Scheduled email** — a queued future send (`scheduled_emails`, status pending/sent/failed) drained by the per-minute cron. *Avoid:* "draft" (drafts aren't queued).
- **Memory / recall** — past `chat_messages` snippets surfaced two ways: `autoRecall` (server auto-inject) + `recall_memory` (agent tool). *Avoid:* "history" (that's the raw session list).
- **Recipient / crew** — a saved contact for the Prep page's 1:1 email drafting (`recipients`). *Avoid:* "Mail Account".
- **Prep** — the page/flow for composing a 1:1 email to a recipient via `draftEmail`. *Avoid:* "compose" (that's the chat composer).
- **Seam / adapter** — the single file that owns one external vendor's wire format (graph.ts, imap.ts, smtp.ts, tavily.ts, client.ts). *Avoid:* "wrapper", "service" (overloaded).

## Flagged ambiguities

- **"Account"** → **Connection** (OneDrive OAuth) vs **Mail Account** (IMAP/SMTP). Always qualify.
- **Two mail stacks coexist** → Graph/Outlook (`microsoft/outlook.ts`, `/api/outlook/*`) AND direct IMAP/SMTP (`mail/*`). The agent's read/send/schedule tools use the IMAP/SMTP stack.
- **"Auth"** → there is none in the app-login sense; "Principal" is identity-scoping, not authentication. When a doc says "auth lands", it means the future real-login milestone.
