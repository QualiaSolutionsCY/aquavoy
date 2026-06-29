import { listEmails, readEmail } from "@/lib/mail/imap";
import { classifyMessage, type InboxCategory } from "./inboxClassifier";
import { markProcessed, isAlreadyProcessed } from "./processedMessages";
import { stagePendingAction } from "@/lib/agents/pendingActions";

/**
 * Automated inbox scan orchestrator (REQ-29). Runs over the two fixed
 * Aquavoy mailboxes, skips already-processed UIDs, classifies each new
 * message with the LLM, records it as processed BEFORE staging (idempotent),
 * and stages ONE pending_actions proposal per financial message.
 *
 * Staged proposals require human confirmation via the existing confirm/undo
 * stack (ADR-003) — no financial write happens without an explicit confirm.
 */

/** The principal whose action-stack receives all staged proposals (REQ-29). */
const SCAN_PRINCIPAL = "Wency";

/** The two fixed source mailboxes: credit notes and voyage details. */
const MAILBOXES = ["admin@aquavoy.com", "rice@aquavoy.com"] as const;

/** Categories that produce a staged pending_actions row. */
const FINANCIAL: InboxCategory[] = ["invoice", "creditNote", "voyageSummary"];

/** Per-run summary envelope returned to the cron caller. */
export interface ScanSummary {
  /** Total messages examined (processed, not skipped). */
  scanned: number;
  /** Messages skipped because (mailbox, uid) was already processed. */
  skipped: number;
  /** Financial messages staged as pending_actions rows. */
  staged: number;
  /** Messages whose processing threw an error (loop continues). */
  errors: number;
  /** Per-mailbox breakdown — scanned + staged counts. */
  byMailbox: Record<string, { scanned: number; staged: number }>;
}

/**
 * Run one inbox scan pass over both source mailboxes.
 *
 * Ordering guarantee:
 *   1. isAlreadyProcessed → skip if true
 *   2. readEmail (fetch body)
 *   3. classifyMessage
 *   4. markProcessed  ← BEFORE stagePendingAction
 *   5. stagePendingAction  (only for financial categories)
 *
 * A per-message try/catch ensures one failure never aborts the batch.
 */
export async function runInboxScan(): Promise<ScanSummary> {
  let scanned = 0;
  let skipped = 0;
  let staged = 0;
  let errors = 0;
  const byMailbox: Record<string, { scanned: number; staged: number }> = {};

  for (const mailbox of MAILBOXES) {
    byMailbox[mailbox] = { scanned: 0, staged: 0 };

    const emails = await listEmails(mailbox, "inbox", 20);

    for (const e of emails) {
      try {
        // ── Idempotency gate ────────────────────────────────────
        if (await isAlreadyProcessed(mailbox, e.uid)) {
          skipped++;
          continue;
        }

        // ── Fetch full body ─────────────────────────────────────
        const detail = await readEmail(mailbox, "inbox", e.uid);

        // ── Classify ────────────────────────────────────────────
        const category = await classifyMessage({
          from: e.from,
          subject: e.subject,
          body: detail.body,
        });

        // ── Mark processed BEFORE staging ──────────────────────
        await markProcessed({ mailbox, uid: e.uid, messageId: null, category });

        // ── Non-financial: processed, not staged ────────────────
        if (!FINANCIAL.includes(category)) {
          scanned++;
          byMailbox[mailbox].scanned++;
          continue;
        }

        // ── Stage ONE pending_actions row per email ─────────────
        const hasAttachments = detail.attachments.length > 0;

        if (category === "creditNote" || category === "invoice") {
          const direction = category === "creditNote" ? "income" : "expense";
          // Note any attachments in the summary so the operator knows a
          // save_email_attachment follow-up is available, but only ONE action
          // is staged (scope-m6: one staged action per email).
          const attachmentNote =
            hasAttachments
              ? ` (${detail.attachments.length} attachment(s) available — save via save_email_attachment after confirming)`
              : "";
          await stagePendingAction({
            principal: SCAN_PRINCIPAL,
            tool: "record_finance_entry",
            args: {
              company: null,
              direction,
              sourceName: e.from,
              sourceRef: e.subject,
              description: e.subject,
              mailbox,
              uid: e.uid,
            },
            summary: `Inbox scan: ${category} from ${e.from} — "${e.subject}". Review and book to the finance ledger.${attachmentNote}`,
          });
        } else if (category === "voyageSummary") {
          await stagePendingAction({
            principal: SCAN_PRINCIPAL,
            tool: "record_voyage_entry",
            args: {
              company: null,
              mailbox,
              uid: e.uid,
              sourceRef: e.subject,
            },
            summary: `Inbox scan: voyage summary from ${e.from} — "${e.subject}". Review and record the voyage entry.`,
          });
        }

        staged++;
        scanned++;
        byMailbox[mailbox].scanned++;
        byMailbox[mailbox].staged++;
      } catch {
        errors++;
        // continue — one bad message never aborts the batch
      }
    }
  }

  return { scanned, skipped, staged, errors, byMailbox };
}
