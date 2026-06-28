# Roadmap · Milestone 6 · Invoice Automation

**Project:** Aquavoy
**Milestone:** 6 (CURRENT)
**Created:** 2026-06-28
**Phases:** 6
**Source:** 2026-06-25 client meeting (transcript + summary) + code audit. Full scope in `.planning/scope-m6.md`; decisions in ADR-006 (voyage storage), ADR-007 (invoice templating), ADR-008 (notifications). Builds on ADR-003 (confirm/undo) and ADR-005 (OneDrive + Supabase hybrid).

See `JOURNEY.md` for the full project arc. This file is ONLY the current milestone's phases.

## Exit Criteria

What "shipped" means for this milestone:

- **The invoice pipeline works end-to-end behind confirm.** The agent can take a credit-note email → save its PDF to OneDrive → generate the correct per-company invoice from Wency's template → stage a finance entry — each step one-click confirm, nothing financial auto-executed (ADR-003).
- **It runs unattended.** An inbox-scan cron checks mail ~4×/day, classifies invoice/credit-note/voyage-summary, is idempotent, and queues proposals in the action-stack.
- **The money is shipping-legible.** Voyage economics — route, cargo, tonnage, price/ton, handler provisions, waiting-time, oil surcharge — are recordable (confirm-before-write) and visible per company (Aquavoy Shipping, Novo Porto).
- **The agreed UX cleanups landed.** Prep page gone; a `/tasks` oversight page exists; the app installs as a standalone PWA on iPhone.
- **Wency gets told.** A web-push notification fires when something needs his confirm (WhatsApp deferred per ADR-008).
- **No regression** in the M1–M5 surface (auth, encryption, traces, confirm/undo, recurring scheduling, inbox briefing, finance views, batch mail, mobile layout).

---

## Phases

| # | Phase | Goal | Status |
|---|-------|------|--------|
| 1 | Quick wins | Remove prep page; add `/tasks` oversight page; ship PWA manifest | CURRENT |
| 2 | Attachment → OneDrive | `save_email_attachment` tool: extract IMAP attachment → OneDrive, confirm + undo | — |
| 3 | Invoice from template | Read PDF → extract → fill Wency's template (docxtemplater) → OneDrive, per-company, confirm | — |
| 4 | Voyage finance schema | `voyage_entries` table + `record_voyage_entry` + Excel-register import + finance drill-down | — |
| 5 | Automated inbox scanning | `~6h` cron classifies + stages invoice/credit-note proposals (idempotent) | — |
| 6 | Notifications | Web-push (PWA) on staged actions + preferences/quiet hours (WhatsApp deferred) | — |

## Phase Details

### Phase 1: Quick wins

**Goal:** Land the three agreed, no-client-input wins before Wency's office visit — clean the prep page out, give him a scheduled-tasks oversight page over the existing backend, and make the app install like a real app on iPhone.

**Touches:** `src/app/prep/*` (delete), `src/components/Nav.tsx` + `Footer.tsx`, `src/app/globals.css`, `src/app/api/outlook/draft/route.ts` (delete), `src/lib/agents/draftEmail.ts` (verify-then-maybe-delete), new `src/app/tasks/page.tsx` + `src/app/api/tasks/list/route.ts` + `src/app/api/tasks/cancel/route.ts`, `public/manifest.json`, `src/app/layout.tsx`.

**Success criteria:**
1. `/prep` returns 404; no `/prep` link in Nav or Footer; `.prep-grid` styles and the draft API route are deleted; a grep confirms no agent tool path breaks.
2. `/tasks` renders a merged reminders+scheduled-emails timeline with status, type, mailbox/owner, recurrence, and a cancel action that hits `DELETE /api/tasks/cancel`; both new routes are auth-gated and principal-scoped (an operator sees only their own); page has loading/error/empty states.
3. `public/manifest.json` is served with name, `start_url`, `display: standalone`, and icons; `layout.tsx` emits `apple-mobile-web-app` meta; iOS add-to-home-screen launches standalone (no browser chrome).

**Requirements:** REQ-23, REQ-24, REQ-25.

### Phase 2: Email attachment → OneDrive

**Goal:** Build the missing foundation — let the agent move an email's PDF attachment into the right OneDrive folder, staged for confirmation and undoable. Everything downstream (invoice generation, finance recording) depends on this.

**Touches:** `src/lib/mail/imap.ts` (attachment extraction + `downloadAttachment`), `src/lib/agents/onedriveTools.ts` (`save_email_attachment` in `TOOL_DEFINITIONS` + `DESTRUCTIVE` set + stage path), `src/lib/agents/executeConfirmedAction.ts` (execute + undo), `src/lib/openrouter/client.ts` (system prompt), tests in `imap.test.ts` + `executeConfirmedAction.test.ts`.

**Success criteria:**
1. `readEmail()` returns an `attachments[]` array; `downloadAttachment(mailbox, uid, filename)` returns the attachment bytes + content-type.
2. Calling `save_email_attachment` in the agent loop returns `confirmation_required` with an `action_id` and a summary — **without** uploading.
3. Confirming runs the upload to OneDrive and returns the new `itemId`/`webUrl`; an undo deletes the uploaded item.
4. No regression in existing mail-read or OneDrive-read tools.

**Requirements:** REQ-26. **Decision:** ADR-003 (confirm-before-write). **Minor client confirm:** OneDrive folder layout (non-blocking).

### Phase 3: Invoice generation from template

**Goal:** The #1 ask — generate an invoice from Wency's actual template. Read a credit-note PDF, extract the fields, fill the per-company template, save to OneDrive, confirm-before-finalize.

**Touches:** new `src/lib/agents/invoiceExtraction.ts` + `invoiceTemplate.ts`, `supabase/migrations/*` (`invoice_templates`), new `scripts/load-invoice-templates.ts`, `onedriveTools.ts` (`generate_invoice_from_template`), `executeConfirmedAction.ts`, e2e test.

**Success criteria:**
1. Given a credit-note/voyage PDF, the system extracts `company, amount, currency, date, voyage_id, shipper, receiver` (LLM-assisted from `unpdf` text), schema-validated.
2. `generate_invoice_from_template` stages a pending action showing the extracted fields + matched template; does not execute until confirmed.
3. On confirm, Wency's template is filled (docxtemplater) and the invoice uploaded to OneDrive; the correct template is selected per company (GEFO vs others) from `invoice_templates`; undo deletes the generated file.
4. E2E: read PDF → extract → fill → upload → confirm passes on a sample.

**Requirements:** REQ-27. **Decision:** ADR-007. **`[NEEDS CLIENT INPUT — blocking]`** templates + field mapping + company→template + output format/folder (July meeting). Scaffold now, wire after.

### Phase 4: Voyage finance schema + Excel register

**Goal:** Capture shipping economics the generic ledger can't — provisions, waiting time, oil, per-voyage route/cargo/tonnage — and surface them per company.

**Touches:** `supabase/migrations/*` (`voyage_entries`), new `src/lib/finance/voyageLedger.ts` + `excelRegisterParser.ts`, `onedriveTools.ts` (`record_voyage_entry`, `import_voyage_register`), `executeConfirmedAction.ts`, `src/app/finance/page.tsx`.

**Success criteria:**
1. `voyage_entries` table exists, RLS service-role only, with the voyage-economics fields (final columns per the client's register).
2. `record_voyage_entry` stages a confirm-before-write row; on confirm it inserts; an example voyage (route, cargo, tonnage, €/ton, handler fee, waiting days+rate, fuel surcharge) appears in the finance page drill-down with correct per-company aggregation.
3. `import_voyage_register` reads an xlsx from OneDrive and stages each row for confirmation; multi-email bundling is a user-driven merge in the UI, not silent grouping.

**Requirements:** REQ-28. **Decision:** ADR-006. **`[NEEDS CLIENT INPUT — blocking]`** register schema + sample file + company mappings + bundling examples + validation rules (July meeting).

### Phase 5: Automated inbox scanning

**Goal:** Make it run itself — check mail ~4×/day, classify financial documents, and stage proposals into the confirm/undo queue (never auto-execute a financial write).

**Touches:** new `src/app/api/mail/scan/run/route.ts`, `src/proxy.ts` (allowlist — prior bug), `vercel.json` (cron), new `src/lib/mail/inboxClassifier.ts` + `inboxScan.ts` + `processedMessages.ts`, `supabase/migrations/*` (`processed_messages`), `executeConfirmedAction.ts`.

**Success criteria:**
1. `GET /api/mail/scan/run` with a valid `CRON_SECRET` returns 200 + a scan summary; without it, 401; the path is in `proxy.ts` allowlist and `vercel.json` crons (~every 6h).
2. New inbox mail is LLM-classified as invoice/credit-note/voyage-summary; each financial message stages exactly one pending action with a human-readable summary into the home-page action-stack.
3. Running the scan twice on the same message produces no duplicate staging (idempotent on `(mailbox, uid)` + Message-ID; `markProcessed` commits before staging).
4. A single per-message error is caught/logged and never aborts the batch.

**Requirements:** REQ-29. **Depends on:** Phases 2–4 for execution of the staged actions (staging + cron + classification ship independently).

### Phase 6: Notifications

**Goal:** Tell Wency when a proposal needs his confirm. Ship web-push as the MVP; design the seam so WhatsApp drops in later.

**Touches:** new `src/lib/notify/adapter.ts` + `webpush.ts` + `triggers.ts`, `supabase/migrations/*` (`notification_preferences`, `notification_log`), `src/lib/agents/pendingActions.ts` (trigger hook), `src/app/api/notify/preferences/*`, a preferences UI surface, `public/manifest.json` (shared with P1).

**Success criteria:**
1. When an action stages for confirmation, a web-push notification is sent to the principal's active channel within seconds, carrying the action summary.
2. The operator can set channel + per-event opt-in + quiet hours; preferences persist and are principal-scoped (RLS); GET/POST `/api/notify/preferences` enforce the session principal.
3. Delivery failures are logged to `notification_log` (fire-and-forget) and never fail the underlying stage; quiet hours suppress sends (logged as suppressed).

**Requirements:** REQ-30. **Decision:** ADR-008 (web-push MVP; WhatsApp/Telnyx deferred to a follow-on pending the business decision). **iOS caveat:** web-push needs the installed PWA; email-digest fallback tested on Wency's device.

---

*Progressive detail: each phase gets task-level breakdown at `/qualia-plan {N}`. Phases 3–4 carry blocking `[NEEDS CLIENT INPUT]` gates resolved at the July office meeting — Phase 1 ships before then; Phases 2, 5 (scaffold), 6 are buildable now.*
