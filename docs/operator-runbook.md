# Aquavoy Assistant — Operator Runbook

This guide is for the people who run the Aquavoy assistant day to day: **Wency** and **Jeanette**. You do not need to be a developer to use it. It explains how to log in, how to talk to the assistant, what happens when the assistant wants to do something risky (like send an email), and how the email and OneDrive connections work behind the scenes.

Read the first two sections to get started. The rest is reference — come back to it when you need it.

---

## 1. Starting and driving the chat

1. **Log in.** Go to `/login` and sign in with your account (Wency or Jeanette). You must be logged in — the assistant only works for a signed-in operator, and everything you do is recorded under your name.
2. **Open the chat.** After logging in you land on the home page (`/`). This is the chat.
3. **Type a request** in plain language. For example: *"Search the crewing mailbox for emails about the Pride of Faial schedule"* or *"List the files in the OneDrive Documents folder."*
4. **The assistant runs and replies.** It figures out which tools it needs (reading a mailbox, searching files, etc.), runs them, and streams its answer back to you a few words at a time. You do not pick the tools — the assistant chooses them based on what you asked.

That is the whole loop: log in → ask → the assistant works and answers.

---

## 2. Confirm and Undo — the safety rule for risky actions

The most important thing to understand: **the assistant never sends email, never schedules email, and never deletes, moves, or renames a OneDrive file on its own.** These are the actions that could cause real harm if the assistant misunderstood you or was tricked by a malicious email or document. So they are *staged* instead of done immediately. This rule is enforced in code — it is not just a polite request to the assistant — per **ADR-003**.

### What gets staged (the gated actions)

These five actions always require your confirmation:

- **Send an email**
- **Schedule an email** (send it later)
- **Delete** a OneDrive item
- **Move** a OneDrive item
- **Rename** a OneDrive item

### What does NOT get staged

- **Creating a folder** in OneDrive — this is low-risk and additive, so it runs immediately.
- **Read-only actions** — reading mail, searching, listing folders/files, browsing. None of these change anything, so they run immediately too.

### How a staged action looks and works

When the assistant wants to do one of the five gated actions:

1. It does **not** do it. Instead it stages the action and shows you a **confirmation card** in the chat with a plain-language summary of exactly what it wants to do (for example: *"Send email to crew@aquavoy.com — subject 'Schedule update'"*).
2. You decide:
   - **Confirm** — the action runs now, for real.
   - **Cancel** — the action is dropped and nothing happens.
3. Nothing happens until you click one of those. The assistant has no way to skip this step.

### Undo

For actions that can be reversed, an **Undo** option appears after you Confirm:

- **Move** or **Rename** a file — Undo puts it back where it was / restores the old name.
- **Delete** a file — the file goes to the OneDrive recycle bin; Undo attempts a best-effort restore and tells you if it cannot.
- **Schedule an email** — Undo cancels the queued email, *as long as it has not been sent yet*.
- **Send an email** — **cannot be undone.** Once a real email goes out, it is out. For this one, the Confirm click *is* the safety check, so read the summary carefully before confirming.

Every staged action — who asked, what it was, when, and the outcome — is recorded as an audit trail, scoped to you as the logged-in operator.

---

## 3. The tool-trace row (seeing what the assistant did)

For transparency and auditing, each assistant reply includes a small **disclosure row** showing which tools ran to produce that answer (for example: *searched mail, listed folder*). Expand it any time you want to see exactly what the assistant touched to answer you. If a reply looks surprising, this row is the first place to check what actually happened.

---

## 4. The 12 company mailboxes

The assistant works with **12 company mailboxes** across two domains. This list is fixed in the system; here it is in full:

**aquavoy.com (7 mailboxes)**

- info@aquavoy.com
- admin@aquavoy.com
- wdr@aquavoy.com
- aquadonna@aquavoy.com
- reizen@aquavoy.com
- crewing@aquavoy.com
- crew@aquavoy.com

**faialbv.com (5 mailboxes)**

- info@faialbv.com
- administratie@faialbv.com
- prideoffaial@faialbv.com
- hr@faialbv.com
- crew@faialbv.com

### How company mail actually works

- **IMAP/SMTP is the authoritative stack for these 12 company mailboxes** (reading, sending, searching, folders, and scheduled sends all go through it) — this is the decision recorded in **ADR-004**.
- **Outlook is for user-personal mail only.** It connects an individual operator's own personal Outlook through that person's sign-in. It cannot reach the company mailboxes, and the assistant has no tool that uses it — Outlook is reached only through the prep page in the UI, never by the assistant. So when you ask the assistant to do anything with a company mailbox, it always uses the IMAP/SMTP path, never Outlook (per **ADR-004**).
- **The mailbox passwords are stored encrypted in the database** (Supabase, the `mail_accounts` table) — *not* in a configuration/environment file. The encrypted password is never shown back in the app; only the server can read it, and only to send mail.

### Managing the mailboxes

You manage the company mail accounts from the **`/emails`** page. That is where mailbox credentials are added or updated. Because the password is stored encrypted, after you save it you will not see the password again — that is expected and correct.

---

## 5. OneDrive connection

The assistant can browse and manage OneDrive files. This runs on a **delegated OAuth** connection — meaning OneDrive is connected once on behalf of the account, and the assistant then acts through that connection.

### Connecting OneDrive

1. Start the connection at **`/api/onedrive/connect`**. This sends you to Microsoft to grant access.
2. Microsoft sends you back to **`/api/onedrive/callback`**, which completes the connection and stores the access tokens.

Once connected, the tokens **refresh automatically** in the background, so you normally do not have to reconnect.

### If OneDrive stops working

If the assistant reports it can no longer reach OneDrive (for example, file listings fail or it says it is not connected), the fix is almost always to **reconnect**:

1. Go to **`/api/onedrive/connect`** again.
2. Sign in to Microsoft and grant access again.
3. The connection and tokens are refreshed, and the assistant can reach OneDrive again.

This happens if the underlying authorization was revoked or expired beyond automatic refresh. Reconnecting is safe to do at any time.

---

## 6. Scheduled email and background jobs (cron)

Two background jobs run on a schedule. You do not start these — they run by themselves — but it helps to know they exist.

- **Scheduled-email sender** — runs **every minute** at `/api/mail/scheduled/run`. This is what actually sends any email you scheduled for later: the job drains the queue once a minute and sends anything that is now due. It is protected by a secret token (`CRON_SECRET`), so only the scheduler can trigger it — nobody can call it from outside.
- **Memory sweep** — runs **every 5 minutes** at `/api/memory/sweep`. This is housekeeping for the assistant's memory.

So when you (or the assistant, after you Confirm) schedule an email, it sits in the queue and the every-minute job picks it up and sends it at the right time. If a scheduled email has not gone out yet, you can still Undo it (see Section 2).

---

## Quick reference

| You want to… | Where / how |
| --- | --- |
| Log in | `/login` |
| Talk to the assistant | `/` (the chat) |
| Approve or stop a risky action | Confirm / Cancel on the card in the chat |
| Reverse a confirmed action | Undo on the card (not available for sent email) |
| See what tools ran | Tool-trace disclosure row under the reply |
| Manage company mailboxes | `/emails` |
| Connect or reconnect OneDrive | `/api/onedrive/connect` |

If something behaves unexpectedly, check the tool-trace row first, and if a connection seems broken, reconnect OneDrive. For anything beyond that, hand it to the development team.
