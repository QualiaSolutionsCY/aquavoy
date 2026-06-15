# ROADMAP — Aquavoy · Milestone 2: Agent Depth

> Current milestone's phase detail. M1 (Trust & Hardening) shipped — archived at `.planning/archive/milestone-1-trust-and-hardening/`. M3/M4 sketched in JOURNEY.md.

**Milestone goal:** Make the agent more *capable* (deeper memory, document understanding) and more *trustworthy* (hard confirm/undo on destructive actions) — building on the now-secure foundation.

**Why now:** M1 made the agent safe to drive; M2 makes it worth driving more. With auth + encryption in place, it's safe to give the agent stronger memory and document reach.

---

## Phase 1 — Durable Memory

**Goal:** Recall is reliable across long histories, not just keyword-grep over recent messages.

**Why:** Today `autoRecall` greps `chat_messages` for ≥5-char word overlaps (`memoryTools.ts:61-100`) — it misses paraphrases and drowns in long histories. Operators expect the agent to "remember what we decided last week."

**Success criteria (to be sharpened in `/qualia-scope 1`):**
- Conversations are summarized into durable per-session (or rolling) summaries the agent can recall, not just raw message-substring matches.
- Recall ranks by salience + recency, not just word-length threshold; demonstrably surfaces a relevant fact from an older session a keyword match would miss.
- The dual-path model (server `autoRecall` + callable `recall_memory`) is preserved; no regression to the existing tool.
- Memory remains scoped to the session principal (REQ-3 invariant from M1 holds).

## Phase 2 — Inline Document Understanding

**Goal:** The agent reads and reasons over a OneDrive document within a single turn.

**Why:** The deps exist (`mammoth`/`pdf-parse`/`xlsx`) and the agent can already locate/download drive files, but reading a file's *content* into the conversation is not a first-class tool. "Summarize the latest invoice in Verzonden Facturen" should work end-to-end.

**Success criteria (to be sharpened in `/qualia-scope 2`):**
- A `read_document` agent tool fetches a drive item, extracts text (Word/PDF/Excel via the existing parsers), and returns content the agent reasons over in the same turn.
- Sensible size/æktype guards (large files truncated with a note, unsupported types reported cleanly).
- Wired into the tool registry (`onedriveTools.ts`) and the system prompt's capability list.

## Phase 3 — Confirm / Undo on Destructive Actions

**Goal:** Destructive tool calls (send email, delete/move file) are gated by a hard confirmation, not just a prompt-level instruction, with undo where the platform allows.

**Why:** The confirm-before-send/delete rule today is soft (system-prompt text, `client.ts:56-122`). For an agent that sends company mail and deletes OneDrive files, that should be an enforced step, not a suggestion.

**Success criteria (to be sharpened in `/qualia-scope 3`):**
- Destructive tools require an explicit confirmation step the model cannot skip (structured, not prose-dependent).
- Where the platform supports it, an undo affordance (e.g. OneDrive delete → restore-from-recycle); where it doesn't (email send), the confirm is the guard and is logged.
- An auditable record of destructive actions taken (who/what/when), scoped to the session principal.

---

**Exit criteria (milestone):** the agent recalls across long histories, reads drive documents inline, and cannot perform a destructive action without an enforced confirm — all without regressing M1's auth/encryption invariants.

**Next:** `/qualia-scope 1` (memory approach is a real fork — summarization model, storage shape, recall ranking — worth grilling + an ADR) then `/qualia-plan 1`.
