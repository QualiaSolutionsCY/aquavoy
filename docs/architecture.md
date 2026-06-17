# Architecture Decision Records

Hard-to-reverse decisions live in [`.planning/decisions/`](../.planning/decisions/).
Each ADR is dated and immutable — this index is the map; the linked file is the record.

| ADR | Title | Summary |
|---|---|---|
| 001 | [ADR-001 — Access-Control Strategy (Phase 1)](../.planning/decisions/ADR-001-access-control-strategy.md) | App password plus a signed session cookie (`SESSION_SECRET` HMAC, `OPERATOR_CREDENTIALS` scrypt hashes) gates operator access. |
| 002 | [ADR-002 — Durable Memory Architecture (M2 · Phase 1)](../.planning/decisions/ADR-002-durable-memory-architecture.md) | Durable memory facts with pgvector embeddings behind a provider-agnostic adapter; extraction at the New-chat boundary plus a light cron sweep. |
| 003 | [ADR-003 — Enforced Confirm / Undo on Destructive Actions (M2 · Phase 3)](../.planning/decisions/ADR-003-enforced-confirm-undo.md) | Destructive actions stage into a pending state requiring explicit Confirm, with Undo support, never executing silently. |
| 004 | [ADR-004 — Keep Both Mail Stacks, One Owner Per Operation (M3 · Phase 2)](../.planning/decisions/ADR-004-mail-stack.md) | Retain both the IMAP/SMTP and Outlook mail stacks; each mailbox declares one authoritative owner per operation (`mail_stack`). |
