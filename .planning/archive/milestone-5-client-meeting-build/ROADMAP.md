# Roadmap · Milestone 5 · Client Meeting Build

**Project:** Aquavoy
**Milestone:** 5 of 5 (CURRENT)
**Created:** 2026-06-18
**Phases:** 4
**Source:** client meeting 2026-06-18 + code audit. Phase 1 fully scoped in `.planning/m5-phase1-scope.md`; finance storage model locked in `.planning/decisions/ADR-005-finance-storage-hybrid.md`.

See `JOURNEY.md` for the full project arc. This file is ONLY the current milestone's phases.

## Exit Criteria

What "shipped" means for this milestone:

- **Recurring scheduling works.** A schedule created with "every 5th of the month" or "every Monday 7pm" fires on time and re-arms its `next_run_at` for the next occurrence; `recurrence_end` is honored; one-off schedules behave exactly as before with no regression in `runDue` / `runDueTasks`.
- **The inbox is legible from the app.** The agent can produce an on-demand inbox briefing (count, important shortlist, spam/ads excluded) over the existing read-only IMAP tools, and `/emails` has a real reader (left list + click-to-read detail) on top of its existing connection manager — all read-only.
- **The money is legible.** Per-company and consolidated expense/income views render from a Supabase finance index that references (never replaces) the OneDrive documents, per ADR-005 — built only after the client provides company mappings + sample invoices.
- **Bulk mail cleanup is fast.** The agent can search by sender and move matching mail to trash or to a folder in batch (the milestone's first mail-write surface), and recipient autocomplete is polished.
- **No regression** in the M1–M4 surface (auth, encryption, agent traces, confirm/undo, mobile layout) — all M5 work ships behind the same gates.

---

## Phases

| # | Phase | Goal | Status |
|---|-------|------|--------|
| 1 | Recurring scheduling | Make scheduled emails and tasks repeat — recurrence + `next_run_at` + re-arm in both runners | CURRENT |
| 2 | Email intelligence | Agent inbox briefing (A4) + a real Emails reader tab (A5), both read-only | — |
| 3 | Finance views | Per-company + consolidated expense/income via the ADR-005 hybrid (extract → Supabase index → render) | — |
| 4 | Batch email actions | Search-by-sender bulk move-to-trash / move-to-folder (A1/A2) + recipient autocomplete polish | — |

## Phase Details

### Phase 1: Recurring scheduling

**Goal:** Both schedulers, which fire once and stop today, gain recurrence so a schedule repeats and re-arms after each fire. The headline use cases are Wency's *"every 5th of the month send all invoices to the accountant"* and *"every Monday 7pm email the crew."* One-off schedules must keep behaving exactly as they do now.

**Detailed source:** `.planning/m5-phase1-scope.md` (A15) — read it for line-level file/table targets and the full acceptance list. Note: that scope doc bundles A4 + A5 into its "Phase 1" as the Monday client demo; in this roadmap A4/A5 are Phase 2 and A15 alone is Phase 1.

**Touches:**
- New migration `supabase/migrations/00XX_recurrence.sql` — add to `scheduled_emails` and `scheduled_tasks` a recurrence field (`recurrence_rule` RRULE or `frequency` enum + interval), `next_run_at timestamptz`, and a nullable `recurrence_end`; keep `scheduled_at` as the first/anchor occurrence; repoint the partial indexes (currently `0007_scheduled_emails.sql:30`, `0013_scheduled_tasks.sql:30`) to drive off `next_run_at`.
- `src/lib/mail/scheduled.ts` — `runDue` (line 161): after sending a recurring row, compute the next occurrence and re-arm (reset to `pending` with a new `next_run_at`) instead of terminally marking `sent`; extend the insert path (line 97), row type (line 35), and select list (line 115) for the new columns.
- `src/lib/agents/scheduledTasks.ts` — `runDueTasks` (line 163): mirror the same next-occurrence logic; extend insert (line 99), row type (line 39), select list (line 118).
- Shared `nextOccurrence(rule, from)` helper — single source of truth for advancing a schedule (cite the chosen library, e.g. `rrule`, in an ADR if one is added).
- Agent tool layer — extend the create-schedule tool input so the agent can set recurrence in natural language ("every 5th", "every Monday 7pm").

**Success criteria** (observable behaviors):
1. A schedule "every 5th of the month" fires on the 5th and afterward has `next_run_at` set to the 5th of the **next** month (verified by re-running the runner past the first fire).
2. A schedule "every Monday 7pm" fires Monday and re-arms for the following Monday.
3. A one-off schedule (no recurrence) fires once and ends `sent` — no regression in `runDue` / `runDueTasks`.
4. `recurrence_end` is honored: past the end date the schedule stops re-arming.
5. Migration applies cleanly on a fresh DB and is idempotent against existing rows (existing one-off rows get a null recurrence and unchanged behavior).

**Depends on:** M4 shipped (handoff complete; this is post-handoff client work).

---

### Phase 2: Email intelligence

**Goal:** Make the inbox legible from inside the app, read-only. Two pieces: (a) an on-demand agent briefing that counts emails, flags the important ones, and filters spam/ads; and (b) a real Emails reader tab — `/emails` today only manages mailbox connections and never shows a message.

**Touches:**
- A4 (briefing): `src/lib/agents/onedriveTools.ts` — add a `briefing` / `inbox_summary` tool alongside the existing read tools (`list_emails` ~480, `read_email` ~509, `search_emails` ~537; handlers ~983 / 1001 / 1019), composing the read tools with no new IMAP surface; `src/lib/openrouter/client.ts` — register/describe the new tool in the agent tool catalogue (read tools described ~118–120). Optional scheduled daily push only if Phase 1's recurring runner is in place.
- A5 (reader tab): `src/app/emails/page.tsx` — add a reader view (left-sidebar message list + right-side detail/read pane) while keeping the existing connection-manager UI reachable (`export default function Emails()` ~86, connect form ~37, `MAILBOXES` ~6); new read-only API route(s) under `src/app/api/emails/...` exposing `list_emails` / `read_email` / `search_emails` to the client; reuse `MAILBOXES` / `GROUPS` from `src/lib/mailboxes` for the picker.

**Success criteria** (observable behaviors):
1. Asking the agent "brief me on the inbox" returns a digest with a total count, an "important" shortlist, and spam/ads excluded — using only the existing read-only tools.
2. The briefing degrades gracefully when a mailbox is unreachable (partial result + note, not a hard error).
3. Opening `/emails` shows a list of recent messages for a connected mailbox (subject, sender, date) in a left sidebar; clicking a message loads its full body via `read_email`.
4. Folder switching (inbox / sent / drafts / trash) and search (text / sender / date) work via the `list_emails` folder param and `search_emails`.
5. Loading, empty (no messages), and error (mailbox unreachable) states are all handled; the tab is strictly read-only — no send / move / delete in this phase.

**Depends on:** Phase 1 (so the briefing's optional scheduled push can ride the recurring runner; the on-demand path and the reader tab can otherwise proceed in parallel).

---

### Phase 3: Finance views

**Goal:** Render per-company and consolidated expense/income views per the ADR-005 hybrid storage model — OneDrive stays the document system-of-record, Supabase holds the finance index/ledger that powers the numbers. Filing-by-company already exists (`companyClause()` propose-then-confirm over OneDrive); this phase adds the totals folders cannot aggregate. The pipeline is **extract → index → render**.

**Touches:**
- `supabase/migrations/*` — new finance index/ledger table(s): per document, a row of `company`, `amount`, `currency`, `date`, `type` (expense/income), and a reference back to the OneDrive item (ADR-005 §Decision). RLS on, per constitution.
- `src/lib/agents/onedriveTools.ts` — extraction tooling that reads invoice/receipt PDFs from the connected OneDrive and proposes index rows (LLM-assisted, human-confirmable; reliable amount/date/type extraction is the named risk in ADR-005 §Consequences).
- `src/lib/microsoft/onedrive.ts` — keep the index in sync when the agent moves / renames / deletes underlying files (index references, never duplicates, the document).
- `src/app/finance/*` — render the consolidated view and the per-company drill-down, reusing the existing `COMPANIES` list (`src/app/finance/page.tsx`) — no new company master is invented.

**Success criteria** (observable behaviors):
1. A consolidated view shows total expense and income across all 8 group companies for a period; a per-company view drills into one entity's figures.
2. Every ledger figure traces back to a specific OneDrive document via its stored reference (extract → index → render, not derived from folders).
3. Extraction is human-confirmable — proposed amount/date/type/company can be corrected before the row is committed.
4. The index stays consistent when the agent moves / renames / deletes an underlying file (reconciled, not duplicated).
5. Classification uses only the existing `COMPANIES` list and Wency's existing OneDrive folder structure.

**Depends on:** Phase 2 (email surface stable) AND the client providing company mappings + sample invoices before the extract step runs. ADR-005 unblocks the storage decision but not the input data.

---

### Phase 4: Batch email actions

**Goal:** Make bulk mail cleanup fast — search by sender, then move matching messages to trash or to a folder in batch (A1 / A2). This is the milestone's first mail *write* surface, so it ships behind confirm/undo. Also polish recipient autocomplete.

**Touches:**
- `src/lib/agents/onedriveTools.ts` + `src/lib/openrouter/client.ts` — add batch move-to-trash / move-to-folder tools layered on a search-by-sender step, registered in the agent tool catalogue; these are writes, so they route through the existing confirm/undo affordance (M2, ADR-003).
- Mail write path (`src/lib/mail/*` / the IMAP move surface) — implement the bulk move/trash operation; the existing read-only tools (`list_emails` / `search_emails`) supply the candidate set.
- Recipient autocomplete UI (compose / Prep path) — polish suggestion behavior.

**Success criteria** (observable behaviors):
1. "Move all email from <sender> to trash" produces a confirmable batch that, on confirm, moves every matching message to trash; undo restores them.
2. Moving matching mail to a named folder works the same way (search → confirm → batch move).
3. The batch is shown before it runs (count + sample) so the operator confirms scope, not a blind action.
4. Recipient autocomplete suggests known recipients responsively while composing.
5. No write occurs without passing through the confirm/undo gate — consistent with the M2 destructive-action contract.

**Depends on:** Phase 2 (the read-only email surface and search are in place before the first bulk-write feature is built on top of them).

---

## Coverage Verification

Every meeting-derived feature scheduled for this milestone maps to exactly one phase.

| Feature (meeting ref) | Phase | Covered? |
|-----------------------|-------|----------|
| A15 Recurring scheduling | Phase 1 | ✓ |
| A4 Inbox briefing | Phase 2 | ✓ |
| A5 Emails reader tab | Phase 2 | ✓ |
| Finance views (ADR-005) | Phase 3 | ✓ |
| A1 / A2 Batch email actions + autocomplete polish | Phase 4 | ✓ |

Deferred beyond M5 (not scheduled): A11 / A13 / A22 doc-gen + bank letter, A27 / A28 roles + hide-files, A26 multi-user auth, A29 voice agent.

---

## When This Milestone Closes

On close:

1. All phase artifacts are archived to `.planning/archive/milestone-5-client-meeting-build/`
2. `tracking.json` `milestones[]` gets a summary entry (num, name, phases_completed, shipped_url, closed_at)
3. Deferred items (doc-gen, roles, multi-user auth, voice agent) are re-evaluated for a possible M6 against the latest client priorities
4. ADR-005 gets OWNER ratification confirmation once the finance views ship (per ADR-005 §Deciders)

---

*Last updated: 2026-06-18*
