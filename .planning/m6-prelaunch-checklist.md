# M6 — Pre-launch checklist (before invoice automation goes live)

Branch `m6-invoice-automation`. The code is built + verified; these are the **deploy/operational gates** that must happen before the new features work for Wency. Most are OWNER / ship-time actions, not code.

## 1. Apply migrations to Supabase prod  ✅ DONE (2026-06-29)

All five tables (`invoice_templates`, `voyage_entries`, `processed_messages`, `notification_preferences`, `notification_log`) were created on the prod project `kdwkcivdiachxrkjctie` (aquavoy/main) via the dashboard SQL Editor — verified present in `public`. **Migration-history note:** they were applied via SQL, not `supabase db push`, so Supabase's `schema_migrations` history doesn't list 0016–0019. They're all `IF NOT EXISTS`, so at ship-time `supabase db push` will run clean (no-op + record history) — OR run `supabase migration repair --status applied 0016 0017 0018 0019` to mark them without re-running. No conflict either way.

<details><summary>(original instructions — kept for reference)</summary>

The finance/invoice features read tables that don't exist in prod yet:
- `supabase/migrations/0016_invoice_templates.sql` (Phase 3 — per-company invoice templates)
- `supabase/migrations/0017_voyage_entries.sql` (Phase 4 — voyage economics)
- `supabase/migrations/0018_processed_messages.sql` (Phase 5 — inbox-scan idempotency) ✅ built
- `supabase/migrations/0019_notifications.sql` (Phase 6 — notification prefs/log) ✅ built

**All four (0016–0019) are committed and awaiting `supabase db push`.** Also set the new env vars before/at ship: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`) and the public one again as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — web-push notifications are inert without them (the app still boots; sends just no-op).

The project is **not linked locally** and the prod secrets are Vercel-"Sensitive" (not pullable), so this can't be done from the dev box — it's a CLI step the OWNER runs (per the constitution: migrations apply through the sanctioned flow, never hand-edited on the remote):

```bash
npx supabase link --project-ref kdwkcivdiachxrkjctie   # one-time
npx supabase migration list                            # confirm 0016–0019 are "local only"
npx supabase db push                                   # applies pending migrations to prod
```

All four tables are **additive** (new tables, RLS-on/service-role-only) — they don't alter or drop anything existing, so applying them is low-risk and won't affect the M1–M5 surface.
</details>

## 2. Ship the branch  🔑 OWNER-gated

`/qualia-ship` is OWNER-only (disable-model-invocation). Fawzi runs it to fast-forward `m6-invoice-automation` → `main` and deploy. ~30 commits waiting. (Per the local-only workflow, "shipped" = on `main` on GitHub; Vercel deploy is the owner's call.)

## 3. Validate the invoice templates with Wency  👤 July 3 office meeting

The `.docx` templates at `assets/invoice-templates/{gefo,novo-porto}.docx` were **authored from the structure of invoice 26-047** (read live from his OneDrive), not from his actual template files. Before trusting auto-generation, at the meeting:
- Open a generated invoice next to one of his real ones and confirm the **layout + field placement** match (issuer/recipient blocks, line items, VAT-shifted, footer/bank).
- Confirm the **per-company routing** (Gefo vs Novo Porto) and the **filename convention**.
- Confirm the three register jargon codes **KWZ / GMP / ZHC** (voyage register) so the column labels read right.
If his real template differs, re-author the two `.docx` (the build script `scripts/build-invoice-templates.ts` + the `invoice_templates` table make this a data change, not a redeploy).

## 4. LOW hardening follow-ups  ✓ both addressed

- ✅ `targetYear` 4-digit guard on the invoice upload path (Phase 3, committed).
- ✅ Register **filename now shown on the record_voyage_entry confirm card** (was deferred; committed `f29eb76`).

---

### What works after migrations are applied + shipped
The agent can: save an email's PDF to OneDrive (confirm/undo) · generate the correct per-company invoice from the template (confirm/undo) · record a voyage to the finance index **and** append it to the real `Reis registratie.xlsx` (confirm; undo removes the DB row) · import the register's historical rows · show per-company voyage economics on the finance page. With P5+P6: scan the inbox ~4×/day and stage proposals, and push a notification when something needs a confirm.
