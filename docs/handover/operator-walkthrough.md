# Aquavoy Assistant — Operator Walkthrough (Live Session Script)

**Who this is for:** the two named operators, **Wency** and **Jeanette**.

**What this document is:** this is the *script* a human runs through with Wency and
Jeanette during the live getting-started session. It is the running order for that
session — the topics to demonstrate and the sequence to demonstrate them in.

**What this document is NOT:** it is **not** a record that the session happened. No
attendance, date, or completion is recorded here. The live walkthrough is delivered
to the operators in person by a human; only that person, during the session, ticks
the coverage checklist at the bottom. Until then every box stays blank.

> Throughout, the session leader points to the **[Operator Runbook](../operator-runbook.md)**
> for depth. This script is the *order of the ceremony*; the runbook is the *reference*.
> Do not re-explain the runbook here — link to the relevant section and move on.

---

## The walkthrough (run these in order)

### 1. Log in at `/login`
- Open `/login` and have the operator sign in with their own account (Wency or Jeanette).
- Point out: the assistant only works for a signed-in operator, and everything they
  do is recorded under their name.
- Depth: **[Runbook §1 — Starting and driving the chat](../operator-runbook.md#1-starting-and-driving-the-chat)**.

### 2. Send a first chat message at `/`
- After login the operator lands on the home page `/` — this is the chat.
- Have them type one plain-language request, e.g. *"List the files in the OneDrive
  Documents folder"* or *"Search the crewing mailbox for emails about the schedule."*
- Watch the assistant choose its own tools, run them, and stream the answer back.
  The operator does not pick tools — the assistant decides based on the request.
- Depth: **[Runbook §1 — Starting and driving the chat](../operator-runbook.md#1-starting-and-driving-the-chat)**.

### 3. Read the tool-trace disclosure row
- Under the assistant's reply, point out the small **disclosure row** listing which
  tools ran to produce that answer (for example: *searched mail, listed folder*).
- Expand it together. Explain this is the first place to check whenever a reply looks
  surprising — it shows exactly what the assistant touched.
- Depth: **[Runbook §3 — The tool-trace row](../operator-runbook.md#3-the-tool-trace-row-seeing-what-the-assistant-did)**.

### 4. Walk the Confirm / Undo card for destructive actions
- Trigger a gated action (e.g. ask the assistant to *send* an email) so the
  **confirmation card** appears in the chat.
- Explain the safety rule out loud: the assistant **never** sends email, schedules
  email, or deletes/moves/renames a OneDrive file on its own. Those five actions are
  staged and wait for the operator. This is enforced in code (ADR-003), not a polite
  request to the assistant.
- Show the two choices on the card — **Confirm** (runs it for real) and **Cancel**
  (drops it, nothing happens) — and where **Undo** appears after a reversible Confirm.
- State the one exception clearly: a **sent email cannot be undone** — for that one,
  the Confirm click *is* the safety check, so read the summary before confirming.
- Depth: **[Runbook §2 — Confirm and Undo](../operator-runbook.md#2-confirm-and-undo--the-safety-rule-for-risky-actions)**.

### 5. Tour the supporting pages
Three pages give a direct UI over the same surfaces the assistant drives. Visit each:

- **`/emails`** — the inbox view across the 12 company mailboxes; this is also where
  mailbox credentials are added or updated. Note that after saving a mailbox password
  it is stored encrypted and is never shown back — that is expected.
- **`/files`** — the OneDrive file browser. If the assistant ever reports it cannot
  reach OneDrive, the fix is almost always to reconnect (`/api/onedrive/connect`).
- **`/prep`** — the email-prep page: crew/recipient lists and 1:1 drafting. Note this
  is the only place user-personal Outlook is reached; the assistant never uses Outlook.
- Depth: **[Runbook §4 — The 12 company mailboxes](../operator-runbook.md#4-the-12-company-mailboxes)**
  and **[§5 — OneDrive connection](../operator-runbook.md#5-onedrive-connection)**.

### 6. Hand off the runbook
- Tell the operators the **[Operator Runbook](../operator-runbook.md)** is their
  permanent reference — it covers everything above in depth plus the scheduled-email
  cron and recovery steps. This script is just for today; the runbook is forever.

---

## Session coverage checklist

The session leader ticks each box **during** the live session, once it has actually
been covered with the operator in front of them. Everything below is intentionally
blank — a ticked box means it was demonstrated live, nothing else.

- [ ] Operator logged in at `/login` with their own account
- [ ] Operator sent a first chat message at `/` and saw the reply stream back
- [ ] Tool-trace disclosure row located and expanded together
- [ ] Confirm / Cancel card shown on a gated (destructive) action
- [ ] Undo behavior explained, including that a sent email cannot be undone
- [ ] `/emails` page toured (inbox + encrypted mailbox credentials)
- [ ] `/files` page toured (OneDrive browser + reconnect path)
- [ ] `/prep` page toured (crew/recipient lists + 1:1 drafting)
- [ ] Operator shown where the Operator Runbook lives for ongoing reference
- [ ] Operator's own questions answered
