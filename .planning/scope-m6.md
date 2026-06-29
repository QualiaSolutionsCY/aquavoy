# Scope — Milestone 6 · Invoice Automation

**Opened:** 2026-06-28 · **Source:** 2026-06-25 client meeting (transcript + summary in `~/Downloads/Meeting with Aquavoy *`) + a code audit against that meeting.
**Method:** synthesized from a 6-way parallel scoping pass (one agent per gap cluster, read-only against the codebase + library docs).
**Profile:** standard. **Branch:** `m6-invoice-automation`.

> This is the increment spec for M6. Phases get full task breakdown at `/qualia-plan {N}`. ADR-006 (voyage storage), ADR-007 (invoice templating), ADR-008 (notifications) record the hard-to-reverse calls. `[NEEDS CLIENT INPUT]` markers gate Phases 3–4 on the July office meeting — they do **not** block Phases 1–2, 5 (scaffold), or 6.

## What the meeting asked for (the gap that defines M6)

Wency's need shifted from *read/organize* to *act*. The end-to-end ask: the agent finds a voyage-summary / credit-note email → saves the attached PDF to a specific OneDrive folder → extracts the figures → **generates an invoice from his existing template** (GEFO vs other company formats) → drops it into the Aquavoy Shipping finance tab → **automatically ~4×/day**, presenting a one-click confirmation queue. Plus: a scheduled-tasks oversight page, move-emails-to-trash (already shipped in M5), a notification "like a WhatsApp", remove the prep page, and "feel like an app". The audit found the invoice pipeline essentially unbuilt; the quick wins were ready immediately.

---

## Phase 1 — Quick wins  ·  effort: low  ·  `ship-now` (no client input)

Three agreed, low-risk wins to land before the July office meeting.

**Build:**
- **Remove prep page** — delete `src/app/prep/page.tsx`, the `/prep` links in `Nav.tsx:13` + `Footer.tsx:9`, the `.prep-grid` styles in `globals.css`, and the dead drafting route `src/app/api/outlook/draft/route.ts`. **Verify first** that `src/lib/agents/draftEmail.ts` is not referenced by any agent tool before deleting it (grep `draftEmail` across `src/`).
- **Scheduled-tasks oversight page** — new `/tasks` page + `GET /api/tasks/list` and `DELETE /api/tasks/cancel`, both auth-gated + principal-scoped. Merge `listTasks` (reminders) + `listScheduled` (emails) into one timeline sorted by `scheduled_at`, with status badge, type indicator, mailbox/owner, recurrence, and a cancel action. Match the `emails`/`finance` page style; include loading/error/empty states.
- **PWA manifest** — `public/manifest.json` (name, short_name, `start_url: /`, `display: standalone`, icons, theme/background color) + `apple-mobile-web-app` meta in `layout.tsx` Metadata. Generate 192/512 icons from the existing `src/app/icon.png` (or accept upscale for MVP).

**Acceptance:** `/prep` → 404, no nav/footer link, `.prep-grid` + draft route gone, no broken tool path · `/tasks` lists reminders+emails with working principal-scoped cancel · `manifest.json` served + add-to-home-screen launches standalone on iOS.

**Decisions:** prep is removed, not replaced (the tasks page is a separate feature) · tasks = one merged timeline, not tabs · static manifest + Next Metadata API (no dynamic manifest route).

---

## Phase 2 — Email attachment → OneDrive  ·  effort: medium  ·  `ship-now` (minor client confirm on folder layout)

The **foundation** of invoice automation, currently missing entirely. Today the agent reads mail and reads drive files but cannot move a PDF from one to the other.

**Build:**
- IMAP attachment extraction in `src/lib/mail/imap.ts` (around the existing `readEmail` download at `imap.ts:312`): a `downloadAttachment(mailbox, uid, filename)` returning bytes + content-type via `mailparser`/imapflow bodystructure; `readEmail` also returns an `attachments[]` metadata array.
- New agent tool **`save_email_attachment`** (`mailbox, uid, attachmentFilename, targetFolderId?`) added to `TOOL_DEFINITIONS` and to the **`DESTRUCTIVE` set** (`onedriveTools.ts:929`) — staged, never executed in the model loop.
- Execution in `executeConfirmedAction.ts`: download bytes → `uploadFile` to OneDrive → return `undo_data: { uploadedItemId }`; undo = `delete_item`.
- System-prompt paragraph describing the tool + the known invoice layout (`Verzonden Facturen/{year}`).
- Tests: `imap.test.ts` (attachment parse), `executeConfirmedAction.test.ts` (stage→confirm→execute).

**Decisions (ADR-003 aligned):** confirm-before-write (a write to the company's shared doc store must be approved) · download bytes at **confirm** time, not stage (PDFs are large; don't pay for cancels) · target folder agent-**inferred** from email context, user-correctable.

**`[NEEDS CLIENT INPUT — minor]`** Confirm the OneDrive invoice folder structure: is `Verzonden Facturen/{year}` correct? Per-company subfolders inside the year? Any PDF naming convention? (Buildable against the documented layout; confirm at the meeting.)

---

## Phase 3 — Invoice generation from template  ·  effort: high  ·  `needs-client-input`

The **#1 headline ask**. See **ADR-007**.

**Build:**
- `src/lib/agents/invoiceExtraction.ts` — LLM-assisted field extraction (`voyage_id, shipper, receiver, amount, currency, date, company`) from `unpdf` text, schema-validated.
- `src/lib/agents/invoiceTemplate.ts` — `docxtemplater` + `pizzip` fill of a `.docx` template.
- `supabase/migrations/00XX_invoice_templates.sql` — `invoice_templates(company, template_file_id, output_format, field_mapping_json)`, RLS service-role only.
- `scripts/load-invoice-templates.ts` — CLI to register client templates from OneDrive.
- Agent tool **`generate_invoice_from_template`** (confirm-before-write) + `executeConfirmedAction` case: select template by company → fill → upload to OneDrive → undo deletes the file. Confirmation card shows extracted fields for correction before the write.
- E2E: read PDF → extract → fill → upload → confirm.

**Decisions:** docxtemplater on `.docx` (xlsx fallback; no PDF generation in MVP) · LLM extraction (not regex/OCR) with human correction at confirm · templates in OneDrive + metadata in Supabase (ADR-005 hybrid) · dynamic per-company template table (not a hardcoded map).

**`[CLIENT INPUT — RESOLVED 2026-06-29 via live OneDrive discovery]`** See `.planning/m6-onedrive-discovery.md`. Templates are already in the connected drive as fillable **`.docx`** at `…/alle firma's/Aquavoy Ltd/Verzonden Facturen/{year}`; two formats (Gefo self-billing `2640xxxx`, and Aquavoy Ltd → Novo Porto sales invoice `YY-NNN`); company is encoded in the filename; full template structure captured from `26-047`. → docxtemplater (ADR-007) confirmed. Remaining (a build step, not a gate): read one real `.docx` to capture Wency's exact placeholder tokens.

---

## Phase 4 — Voyage finance schema + Excel register  ·  effort: high  ·  `needs-client-input`

Extend finance for shipping economics the generic ledger can't hold. See **ADR-006**.

**Build:**
- `supabase/migrations/00XX_voyage_entries.sql` — parallel RLS-gated table (route, dates, cargo, tonnage, price/unit, handler provisions, waiting-time days+rate, oil surcharge, vessel, source_ref, status). Final columns set against the sample register.
- `src/lib/finance/voyageLedger.ts` — per-voyage + per-company aggregation, mirroring `ledger.ts:79–128`.
- Agent tool **`record_voyage_entry`** (confirm-before-write) + `executeConfirmedAction` case.
- `src/lib/finance/excelRegisterParser.ts` + **`import_voyage_register`** tool — read Wency's xlsx (existing `read_file`), stage each row for confirmation.
- Finance page (`src/app/finance/page.tsx`) — per-company voyage drill-down card.

**Decisions:** parallel `voyage_entries` table (not nullable columns / not JSONB) · single-file on-demand import (no continuous sync) · multi-email bundling is a **user-driven merge in the UI** (not silent LLM grouping).

**`[CLIENT INPUT — RESOLVED 2026-06-29 via live OneDrive discovery]`** See `.planning/m6-onedrive-discovery.md`. The register is `Reis registratie.xlsx` at `/Documenten/ttt/Bureaublad/`, one sheet per year, with 26 real columns (REIS, VAN/NAAR, LADING, TONNAGE, P/TON, OPBRENGST, PROVISIE -5%, LIGGELD, GASOLIE/OLIE KOSTEN, DAGEN, NETTO P/D, …) — the authoritative `voyage_entries` schema (supersedes the ADR-006 placeholder). Three jargon codes (KWZ, GMP, ZHC) to confirm with Wency but they don't block the table. **Refinement (per 2026-06-29 operator note):** Wency wants the agent to FILL the actual `Reis registratie.xlsx` (append the voyage row) AND prepare the invoice from the default `.docx` template — so P4 writes back to his Excel file (append-row → re-upload), not only a Supabase index.

---

## Phase 5 — Automated inbox scanning  ·  effort: medium  ·  `ship-now` (staging) / depends on P2–P4 for full execution

The "checks email 4×/day and shows what's ready" behavior. **Stages proposals; never auto-executes a financial write.**

**Build:**
- `src/app/api/mail/scan/run/route.ts` — cron handler, CRON_SECRET-gated, mirroring `api/mail/scheduled/run`. **Allowlist the new path in `src/proxy.ts`** (prior cron-allowlist bug) and add a `~every 6h` entry to `vercel.json`.
- `src/lib/mail/inboxClassifier.ts` — LLM classify `invoice | creditNote | voyageSummary | important | routine | spam` (separate from `briefing.ts`).
- `supabase/migrations/00XX_processed_messages.sql` + `src/lib/mail/processedMessages.ts` — idempotency on `(mailbox, uid)` + `message_id`.
- `src/lib/mail/inboxScan.ts` — orchestrate list → classify → markProcessed → `stagePendingAction` per financial message.
- `executeConfirmedAction` cases for the staged inbox action(s).

**Decisions:** separate classifier from briefing · idempotency on UID + Message-ID (no body hash) · **one staged action per email** (not per step) for a clean confirm/undo · surface in the existing home-page action-stack (no new page) · classifier on the existing OpenRouter `complete()` (no new SDK).

**Note:** the staging + cron + classification ship independently; the *execution* of save-attachment / record-finance / generate-invoice depends on Phases 2–4 being live. `markProcessed` must commit **before** staging so a retried cron skips already-seen mail.

---

## Phase 6 — Notifications  ·  effort: medium  ·  `ship-now` (web-push) / WhatsApp deferred

Tell Wency when proposals are ready. See **ADR-008**.

**Build:**
- `src/lib/notify/adapter.ts` (`NotificationChannel` seam) + `webpush.ts` (MVP) — vendor-agnostic so WhatsApp/Telnyx drops in later.
- `supabase/migrations/00XX_notification_preferences.sql` — `notification_preferences` (principal, channel, per-event opt-in, quiet-hours) + `notification_log` (90-day audit), RLS principal-scoped.
- `src/lib/notify/triggers.ts` — fire-and-forget `notifyOnStage` hooked into `pendingActions.stagePendingAction`; delivery errors logged, never thrown.
- `src/app/api/notify/preferences` + a preferences UI surface.

**Decisions:** web-push MVP (zero vendor friction, rides the Phase-1 PWA) · adapter seam so WhatsApp is a drop-in later · trigger on pending-action stage first; scheduled-task-fire notifications opt-in.

**`[NEEDS OWNER/CLIENT DECISION]`** WhatsApp Business channel (Telnyx) is **deferred** — provisioning a WhatsApp number + per-message cost is a business decision (not a proxy-approvable engineering call). Confirm at the meeting whether web-push suffices or WhatsApp must be provisioned. **iOS caveat:** web-push works on the *installed* iPhone PWA (iOS 16.4+); the email-digest fallback must be tested on Wency's device.

---

## Sequencing & gates

```
P1 Quick wins ───────────────► ship before July office meeting (no deps)
P2 Attachment→OneDrive ──────► foundation (buildable now)
        │
        ▼
P3 Invoice from template ────► [client input: templates]   ─┐
P4 Voyage schema + register ─► [client input: register]     ├─► P5 Auto inbox scan (stages proposals)
        │                                                    ─┘        (execution needs P2–P4 live)
        ▼
P6 Notifications (web-push) ──► ship-now; WhatsApp deferred (ADR-008)
```

## Open items carried to the July 3 office meeting
1. OneDrive invoice folder structure (P2 — minor).
2. Invoice template files + field mapping + company→template assignment + output format/folder (P3 — blocking).
3. Excel voyage-register schema + sample file + company mappings + bundling examples + validation rules (P4 — blocking).
4. Notification channel decision: web-push sufficient, or provision WhatsApp Business number + accept cost? (P6 — business).
5. (External, not ours) Wency's requested **budget API** — pending his internal team.
