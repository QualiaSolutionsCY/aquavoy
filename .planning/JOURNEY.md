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

## Milestone 4 · Handoff  `[CURRENT · FINAL]`

Standard 4-phase Qualia handoff: documentation pass, deployment hardening + monitoring, knowledge transfer, and final acceptance.

---

*Progressive detail: M1 is planned now. M2/M3 get full phase detail when `/qualia-milestone` opens them — their shape will shift based on what M1 ships and what new capabilities you prioritize.*
