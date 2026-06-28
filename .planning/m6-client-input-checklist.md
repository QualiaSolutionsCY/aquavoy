# Aquavoy — What to bring to the office meeting (Fri after 2 July)

> For Wency. To finish the invoice-automation features (making invoices from your
> templates, and the voyage finance register), we need a few real examples from
> you. Bring these to the office and we can build + test them live in the session.
> Everything else from the 25 June call (prep page removed, scheduled-tasks page,
> "app on your phone", saving email attachments to OneDrive) is already done.

---

## 1. Invoice templates — so the agent can MAKE invoices for you

This is the big one ("see how you're gonna make invoices for me"). We need your
actual templates, not a description.

- [ ] **One example invoice file per format** you use — e.g. one for **GEFO**, one
      for **W&D**, and any other company that has a different layout. Word (.docx)
      is best; Excel (.xlsx) is fine too. (If you only have PDFs, tell us — that
      changes the approach.)
- [ ] **For each template, point out where each value goes.** Easiest: open the
      template and tell us "the voyage number goes here, the amount goes here, the
      date here, the supplier/customer here." A screenshot with arrows, or just
      walking us through it live, is perfect.
- [ ] **Which company uses which template.** e.g. "GEFO credit notes → GEFO
      template; everything else → the standard one." And what to use for a new
      company we haven't seen.
- [ ] **Where should the finished invoice be saved** on OneDrive? (We're assuming
      `Verzonden Facturen / {year}` under Aquavoy Ltd — confirm or correct.)
- [ ] **2–3 real source documents** (credit notes / voyage summaries) that you'd
      normally turn into an invoice — so we can test the whole flow end-to-end:
      email → save the PDF → read it → make the invoice → you click confirm.

## 2. The Excel voyage register — so the money matches how your ship really earns

You showed us the specialized Excel sheet (from/to, dates, cargo, tonnage, price
per ton, handler provisions, waiting days, oil, earnings). To fold that into the
finance page we need its real shape.

- [ ] **A sample of the actual Excel register** (a recent month is fine — you can
      scramble names/amounts if you prefer). This is the source of truth for the
      columns.
- [ ] **The column list**, and which are always filled vs. sometimes blank
      (route, dates, cargo, tonnage, €/ton, **handler provision**, **waiting
      days + day-rate**, **oil/fuel surcharge**, vessel, earnings…).
- [ ] **Which companies have voyages** — we assume **Aquavoy Shipping** and
      **Novo Porto** mainly; confirm which of the 8 do and don't.
- [ ] **2–3 real "bundling" examples** — show us a case where the credit note
      (to admin@) and the voyage details (to rice@) are really the *same* voyage,
      and how you currently combine them. This teaches the agent your logic.
- [ ] **Any rules/limits** — e.g. tonnage is always > 0, currency is always EUR,
      a field that must never be empty.

## 3. Quick confirmations (1 minute)

- [ ] **OneDrive invoice folder** — is `Verzonden Facturen / {year}` correct, and
      are there per-company subfolders inside the year?
- [ ] **How do you want to be notified** when invoices are ready to confirm? We're
      shipping a **phone/app push notification** first (no setup, no cost). Real
      **WhatsApp** is possible but needs a dedicated WhatsApp Business number and a
      small per-message cost — decide if that's worth it, or if the app push is
      enough for now.

## 4. On your side (not ours)

- [ ] **Budget API** — you mentioned your internal team would come back on this.
      Any update? (Doesn't block anything we're building.)

---

### What's already done and waiting for you to try
- Prep page removed (you said it had no value).
- **Tasks page** added — one place to see every reminder + scheduled email the
  agent has queued, with a cancel button.
- **Installs like an app** on your iPhone (add to home screen → opens full-screen).
- **Saving an email's PDF to OneDrive** — the agent can now take an attachment from
  a mail and file it to the right OneDrive folder, and you confirm before it saves
  (and can undo it).

Bring the items in sections 1–2 and we'll build the invoice-making and the voyage
finance register with you in the room.
