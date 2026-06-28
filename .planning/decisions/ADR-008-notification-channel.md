# ADR-008 — Notification Channel: ship web-push (PWA) as MVP, defer WhatsApp (Telnyx) pending a business decision

**Date:** 2026-06-28
**Milestone:** M6 — Invoice Automation (Phase 6)
**Status:** Proposed
**Deciders:** Moayad (EMPLOYEE) — engineering MVP call. **The WhatsApp side is a business decision reserved for the OWNER + client** (number provisioning + per-message cost) — not an engineering choice and explicitly not made here ("No proxy approval").
**Domain terms:** staged action, notification channel, quiet hours, WhatsApp Business API
**Touches:** `src/lib/notify/*` (new adapter seam), `src/lib/agents/pendingActions.ts`, `supabase/migrations/*` (`notification_preferences`, `notification_log`), `src/app/api/notify/*`, `public/manifest.json` (PWA, shared with REQ-25)

## Context

The 2026-06-25 meeting: Fawzi asked how Wency wants to be notified when invoices are prepared; Wency answered **"Like a WhatsApp"** (transcript 12:24–12:39). Today there is **no notification channel at all** — reminders only go out as self-addressed email (`scheduledTasks.ts`); there is no push, no WhatsApp.

WhatsApp Business messaging (whether via Telnyx — the Qualia-standard telephony vendor — or Twilio) requires: provisioning a dedicated business number, Meta template approval (≈2–5 days), and per-message billing (~0.01–0.10 USD depending on conversation type). That is real cost + setup friction and a business decision, not something to silently commit during a scoping pass.

## Decision

**Ship PWA web-push as the M6 MVP notification channel; design the notify layer as a vendor-agnostic adapter so WhatsApp drops in later without rework; defer the WhatsApp channel itself to a follow-on gated on the client's go-ahead.**

1. **MVP channel = web-push (Service Worker).** Native to modern browsers, **zero vendor setup, zero per-message cost**, ships inside M6. Rides the PWA manifest already added in Phase 1 (REQ-25). Fires when a proposal/action stages for confirmation (and, opt-in, when a scheduled task fires).
2. **Adapter seam (`src/lib/notify/adapter.ts`).** A `NotificationChannel` interface (`send(principal, message, metadata)`); `webpush.ts` implements it now; `whatsapp.ts` (Telnyx) and an email-digest fallback implement it later. Triggers are **fire-and-forget** — a delivery failure logs to `notification_log`, it never throws or fails the underlying `stagePendingAction` insert.
3. **Preferences + quiet hours** in a `notification_preferences` table (principal-scoped, RLS): channel choice, per-event opt-in, quiet-hours window (handles midnight wrap). `notification_log` keeps a 90-day audit of every send attempt.
4. **WhatsApp via Telnyx is the planned follow-on** (preferred over Twilio: same vendor as the rest of the Qualia stack, `TELNYX_API_KEY` already conventional). It is **deferred to M7 / a follow-on**, contingent on: (a) the client agreeing to provision a WhatsApp Business number, and (b) OWNER sign-off on the per-message cost. Until then the env stays optional and the channel is disabled-but-bootable.

## Alternatives considered

- **WhatsApp via Telnyx now.** Rejected for M6 — 2–5 day Meta template approval + number provisioning + cost approval would block the milestone on a business decision; web-push delivers the "tell me when it's ready" value immediately.
- **Twilio WhatsApp.** Rejected as the default — different vendor from the Qualia standard, comparable/again per-message cost, more setup friction than Telnyx. (Available as a swap behind the same adapter if ever needed.)
- **Email digest only.** Rejected as the primary — not "like a WhatsApp," loses real-time push; kept as a fallback channel when web-push is declined/unsupported.
- **In-app toast only.** Rejected — only works while the operator is watching the app; doesn't surface an invoice waiting overnight.

## Consequences

- **Easier:** real-time notifications ship in M6 with no vendor onboarding; the adapter means adding WhatsApp later is one implementation file + env, not a refactor.
- **Harder / caveats:** **iOS Safari web-push is limited** (works on installed PWAs on iOS 16.4+; otherwise no web-push) — since Wency runs the installed iPhone PWA this is viable, but the **email-digest fallback is essential** and must be tested on his device; notification fatigue (one push per staged action) is mitigated by quiet hours, with batching deferred.
- **Open business item:** WhatsApp number + cost is a `[NEEDS OWNER/CLIENT DECISION]` carried into the July meeting — confirm whether web-push is sufficient or WhatsApp must be provisioned, before committing the follow-on.
