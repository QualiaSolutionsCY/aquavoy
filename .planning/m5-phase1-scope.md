# M5 — Client Meeting Build · Phase 1 Scope

**Milestone:** M5 "Client Meeting Build" (M1–M4 shipped)
**Phase 1 owner commitment:** updates to the client **by Monday 2026-06-22** (Fawzi)
**Source:** client meeting 2026-06-18 + code audit
**Status:** read-only scope doc — no code changed yet

## Why this phase is exactly these three items

Phase 1 is the **unblocked Monday commitment** only. Everything else in M5 is parked because it is either (a) already in flight on a separate track or (b) blocked on a client decision.

- **Already being built elsewhere (NOT in this scope):** PDF-read fix, left-side nav + mobile burger, recipient autocomplete.
- **Blocked, deferred to a later M5 phase:** the finance engine, on two open client decisions —
  - **Q1:** separate agent-managed database vs. organizing the existing OneDrive.
  - **Q2:** client must provide company mappings + sample invoices.
  Finance cannot start until both are answered, so it is out of Phase 1 by definition.

The three items below depend on nothing external. They are buildable now and demoable Monday.

---

## A15 — Recurring scheduled tasks  ·  **L**  ·  highest value

**Description.** Both schedulers today fire **once** and stop. The tables store a single `scheduled_at timestamptz` (`supabase/migrations/0007_scheduled_emails.sql:16`, `supabase/migrations/0013_scheduled_tasks.sql:17`) with no recurrence column, and the cron runners select pending rows `scheduled_at <= now()` and mark them `sent` — there is no concept of a "next" occurrence (`src/lib/mail/scheduled.ts:161` `runDue`, `src/lib/agents/scheduledTasks.ts:163` `runDueTasks`). Add recurrence so a schedule repeats. Critical use cases from the meeting: *"every 5th of the month send all invoices to the accountant"* and *"every Monday 7pm email the crew."*

**Files / tables to change.**
- New migration `supabase/migrations/00XX_recurrence.sql` — add to `scheduled_emails` and `scheduled_tasks`: a recurrence field (`recurrence_rule text` RRULE, or a `frequency` enum + interval), plus `next_run_at timestamptz` and a nullable `recurrence_end`. Keep `scheduled_at` as the first/anchor occurrence. Update the partial indexes (`...0007...:30`, `...0013...:30`) to drive off `next_run_at`.
- `src/lib/mail/scheduled.ts` — `runDue` (line 161): after sending a recurring row, compute the next occurrence and either re-arm the row (reset to `pending` with a new `next_run_at`) or insert the next instance, instead of terminally marking `sent`. Extend the insert path (line 97) + row type (line 35) + select list (line 115) for the new columns.
- `src/lib/agents/scheduledTasks.ts` — `runDueTasks` (line 163): mirror the same next-occurrence logic; extend insert (line 99), row type (line 39), select list (line 118).
- Add a small `nextOccurrence(rule, from)` helper (shared util) — single source of truth for advancing a schedule; cite a library (e.g. `rrule`) in the ADR if one is added.
- Agent tool layer: extend the create-schedule tool input so the agent can set recurrence in natural language ("every 5th", "every Monday 7pm").

**Acceptance criteria.**
- A schedule created with "every 5th of the month" fires on the 5th and, after firing, has a `next_run_at` set to the 5th of the **next** month (verified by re-running the runner against a clock past the first fire).
- A schedule created with "every Monday 7pm" fires Monday and re-arms for the following Monday.
- A one-off schedule (no recurrence) behaves exactly as today — fires once, ends `sent`. No regression in `runDue` / `runDueTasks`.
- `recurrence_end` is honored: past the end date the schedule stops re-arming.
- Migration applies cleanly on a fresh DB and is idempotent against existing rows (existing one-off rows get a null recurrence and unchanged behavior).

---

## A4 — Agent daily briefing / inbox summary  ·  **M**

**Description.** No briefing capability exists today. Add an **on-demand** briefing the agent can produce: count emails, flag the important ones, and filter out spam/ads — a "what happened in the inbox" digest. Built on the existing read-only IMAP tools so it ships without any new mail infrastructure.

**Files / tables to change.**
- `src/lib/agents/onedriveTools.ts` — add a `briefing` (a.k.a. `inbox_summary`) tool alongside the existing read tools (`list_emails` at line 480, `read_email` at 509, `search_emails` at 537; handlers at 983 / 1001 / 1019). It composes the read tools (count, classify important vs. spam/ads, summarize), no new IMAP surface.
- `src/lib/openrouter/client.ts` — register/describe the new tool in the agent tool catalogue (the read tools are described at lines 118–120).
- **Optional scheduled push** — only if A15 lands first: a daily briefing can be registered as a recurring scheduled task via the A15 runner. If A15 slips, ship briefing as on-demand only; the scheduled push is not a Phase 1 blocker.

**Acceptance criteria.**
- Asking the agent "brief me on the inbox" returns a digest with a total count, an "important" shortlist, and spam/ads excluded — using only the existing read-only tools (no new mailbox writes).
- The briefing degrades gracefully when a mailbox is unreachable (partial result + note, not a hard error).
- If A15 is merged: a recurring "daily briefing" schedule can be created and re-arms per A15 rules. If A15 is not merged: on-demand path works standalone.

---

## A5 — Emails reader tab  ·  **M**

**Description.** `src/app/emails/page.tsx` is currently **only a mailbox-connection manager** — it connects/disconnects IMAP/SMTP accounts (`export default function Emails()` at line 86; connect form at line 37; `MAILBOXES` list at line 6) and never shows a single message. Add an actual reader: a left-sidebar email list + click-to-read detail pane, built against the existing read-only IMAP tools (`list_emails` / `read_email` / `search_emails` in `src/lib/agents/onedriveTools.ts`).

**Files / tables to change.**
- `src/app/emails/page.tsx` — add a reader view (left-sidebar list of messages + right-side detail/read pane). Keep the existing connection-manager UI reachable (e.g. tab/section) — do not delete account management.
- New API route(s) under `src/app/api/emails/...` (or extend an existing mail route) to expose `list_emails` / `read_email` / `search_emails` to the client component — server-side, read-only, no new IMAP write surface.
- Reuse `MAILBOXES` / `GROUPS` (`src/lib/mailboxes`) for the mailbox/folder picker.

**Acceptance criteria.**
- Opening `/emails` shows a list of recent messages for a connected mailbox (subject, sender, date) in a left sidebar.
- Clicking a message loads its full body in the detail pane via `read_email`.
- Folder switching works (inbox / sent / drafts / trash) per the `list_emails` folder param.
- Search filters the list (text / sender / date) via `search_emails`.
- Empty (no messages), loading, and error (mailbox unreachable) states are all handled.
- Strictly read-only — no send/move/delete from this tab in Phase 1.

---

## Effort summary

| Item | Effort | Notes |
|------|:------:|-------|
| A15 Recurring scheduled tasks | **L** | Migration + both runners + shared next-occurrence helper. Highest value. |
| A4 Daily briefing | **M** | New agent tool over existing read tools; scheduled push gated on A15. |
| A5 Emails reader tab | **M** | New reader UI + read-only API route over existing IMAP tools. |

**Suggested build order:** A15 → A4 → A5. A15 is the highest-value item and unlocks A4's optional scheduled push; A4 and A5 both reuse the existing read-only IMAP tools and can parallelize after A15.

---

## Deferred to later M5 phases

Parked deliberately — either blocked on a client decision or lower priority than the Monday commitment.

- **Batch email move-to-trash / move-to-folder** (A1 / A2) — write operations on mail; out of scope for the read-only Phase 1.
- **Finance engine** (A19 / A20 / A23 / A17) — ingest invoices/receipts → ledger, multi-entity classification, per-entity + consolidated views, voyage-invoice generation. **Blocked on Q1 (separate DB vs. organize OneDrive) and Q2 (client mappings + sample invoices).**
- **Doc generation** (A11 / A13 / A22) — PDF-create, templating, bank-letter generation. Depends on finance decisions.
- **Roles + hide-files** (A27 / A28) — access control over files.
- **Persistent task panel** (A18) — standing UI for scheduled/in-flight tasks.
- **Separate logins / multi-user auth** (A26) — per-user accounts.
- **Voice agent** (A29) — **last**, after the text agent surface is complete.
- **Staged bank / payment permissions** (A30) — graduated approval for financial actions.

---

*Phase 1 ships the three unblocked items above for the Monday 2026-06-22 client update. Finance and all write/permission-sensitive work wait on the two open client decisions (Q1, Q2).*
