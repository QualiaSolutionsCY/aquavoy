# JOURNEY — Aquavoy

> The full arc from today's shipped state to Handoff. Milestone 1 fully detailed; M2–M3 sketched (filled in by `/qualia-milestone` when each opens). Proposed — pending approval.

**Starting point:** a functional, well-built internal AI assistant (11 validated capabilities, see PROJECT.md). The dominant gap from the codebase map is **trust**: the unauthenticated `/api/chat` surface can send company email and delete/move OneDrive files, credentials sit in plaintext at rest, and there are zero tests. So the arc starts by making the powerful surface safe, then deepens the agent, then polishes operations, then hands off.

---

## Milestone 1 · Trust & Hardening  `[SHIPPED]`

**Why now:** the app does powerful, irreversible things (send mail, delete files) with no access control and no test safety net. Every other improvement is riskier to ship until this is closed. Driven directly by `.planning/codebase/concerns.md` (HIGH-1/2/3).

- **Phase 1 — Access control.** Gate the app and authenticate the API routes so only the real operators can drive the agent. Verify a principal's identity (not just shape-whitelist it), protect every mutating/PII route the way the cron route already is.
- **Phase 2 — Credentials at rest.** Encrypt mailbox passwords and OAuth access/refresh tokens before they hit Postgres; decrypt only server-side at use. Remove plaintext-at-rest exposure.
- **Phase 3 — Migration integrity + test safety net.** Add the missing `scheduled_emails` migration to disk, reconcile the duplicate `mail_accounts` email constraints, and stand up a seam-level test suite (adapter mocks for Graph/IMAP/SMTP, route-level for agent tool dispatch + auth).

**Exit criteria:** no unauthenticated route can send mail or mutate files; no plaintext secret at rest; `supabase/migrations/` matches the live schema; `npm test` runs and green on the seams.

## Milestone 2 · Agent Depth  `[SHIPPED]`

**Goal:** make the agent more capable and more reliable — richer memory (conversation summarization / semantic recall beyond keyword match), inline document understanding (read + summarize a drive file in one turn), and stronger confirm/undo affordances for destructive actions. *Shipped: durable memory (ADR-002), inline doc understanding, enforced confirm/undo (ADR-003).*

## Milestone 3 · Operations Polish  `[SHIPPED]`

**Goal:** observability (log which model/tools actually ran, surface tool-call traces), decide the two-mail-stack question (Graph/Outlook vs IMAP/SMTP — keep both or converge), and UX refinement across Emails / Files / Prep. *Shipped: agent traces (0011), mail-stack decision (ADR-004, 0012), bolt-style chat + visual polish.*

## Milestone 4 · Handoff  `[SHIPPED]`

Standard 4-phase Qualia handoff: documentation pass, deployment hardening + monitoring, knowledge transfer, and final acceptance. *Shipped: repo/operator docs, prod deployment verified (12 migrations, RLS, no client-side secrets), end-to-end QA checklist, credential handover + client acceptance sign-off.*

## Milestone 5 · Client Meeting Build  `[CURRENT]`

**Why now:** the system was handed off, then the client meeting on 2026-06-18 surfaced a concrete set of post-handoff feature requests. This milestone turns those requests into real work. Source of truth for the priority order and exit bars is the client meeting transcript plus the code audit; Phase 1 is fully scoped in `.planning/m5-phase1-scope.md`, and the finance storage model is locked in `.planning/decisions/ADR-005-finance-storage-hybrid.md`. The arc runs strongest-value-first: make schedules repeat, then make the inbox legible, then make the money legible, then make bulk mail cleanup fast.

- **Phase 1 — Recurring scheduling (CURRENT).** Both schedulers fire once and stop today. Add recurrence (RRULE / frequency + `next_run_at` + `recurrence_end`) to `scheduled_emails` and `scheduled_tasks` so a schedule repeats and re-arms after firing. Headline use case: *"every 5th of the month send all invoices to the accountant"* (Wency) and *"every Monday 7pm email the crew."* One-off schedules must keep behaving exactly as today. Detailed scope: `.planning/m5-phase1-scope.md` (A15).
- **Phase 2 — Email intelligence.** Two pieces over the existing read-only IMAP tools: (a) an agent daily-briefing / inbox-summary capability — count emails, flag the important ones, filter spam/ads (A4); and (b) a real Emails reader tab — left-sidebar message list + click-to-read detail pane on `/emails`, which today only manages mailbox connections (A5). Both stay strictly read-only.
- **Phase 3 — Finance views.** Build the per-company and consolidated expense/income views per ADR-005's hybrid model: OneDrive stays the document store, Supabase holds a finance index/ledger (company, amount, currency, date, type, OneDrive reference). The pipeline is extract → index → render. Filing-by-company already exists; this adds the numbers the folders can't aggregate.
- **Phase 4 — Batch email actions.** Search-by-sender then move-to-trash / move-to-folder in bulk (A1 / A2) — the first mail *write* surface in this milestone — plus recipient-autocomplete polish.

**Deferred beyond M5** (noted, not scheduled): doc generation / PDF-create + templating + bank-letter (A11 / A13 / A22), roles + hide-files (A27 / A28), multi-user auth / separate logins (A26), and the voice agent (A29).

---

*Progressive detail: Phase 1 is fully scoped in `.planning/m5-phase1-scope.md`. Phases 2–4 get full phase detail when `/qualia-milestone` / `/qualia-plan` opens them — finance (Phase 3) is unblocked by ADR-005 but still needs the client's company mappings + sample invoices before the extract step runs.*
