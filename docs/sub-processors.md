# Sub-processors

Outside companies that process personal data or workspace content on Islestone's behalf. Started by sub-phase 2.6c with Resend (owner decisions 87, 120 and 121, `docs/HANDOFF.md`). Hardening H6 and sub-phase 8.6 (`docs/ROADMAP.md`) complete the register and publish it; until then this page lists only the entries recorded so far, and an entry is added in the same pull request as the data flow it records.

Facts marked "(re-check)" were taken from search summaries, not a live page, and are re-checked against the provider's own site before go-live.

## Resend

| | |
|---|---|
| **What it does** | Receives the inbound intake email for `in.islestone.cloud` and posts a signed `email.received` webhook for each email; Islestone fetches the message through its API (sub-phase 2.6c, `docs/intake.md`, "Inbound email (2.6c)"). Sends Islestone's outbound mail over SMTP (`docs/deployment.md`, "Email (Resend)"). |
| **Data** | Inbound: whatever a sender emails to an intake address (the sender's name and address, the subject, the text, attachments, the headers). Outbound: the recipient's address and the email's text (invites, password resets, assignment and digest emails, intake confirmations, acknowledgements and notices). |
| **Since** | Sub-phase 2.6c (inbound), owner decision 120; outbound once an operator points `SMTP_HOST` at it. Neither flows until an operator configures it: inbound email is behind `INTAKE_EMAIL`, closed in production by default. |
| **Region** | Both domains (the sending domain and `in.islestone.cloud`) are created in Resend's eu-west-1 region; the region is fixed when a domain is created (re-check). |
| **Storage** | Received mail and Resend's logs are very likely stored in the US for 30 days, and no API to delete them was found (re-check). Accepted by the owner (decision 121). |
| **Transfer basis** | The Standard Contractual Clauses in Resend's data processing addendum (resend.com/legal/dpa) and the EU–US Data Privacy Framework (re-check Resend's certification). |
| **What Islestone keeps** | A request's title, its sanitised text (encrypted), the sender's name and address (personal data, encrypted, matched by a lookup hash), follow-ups (encrypted) and a delivery record holding the sender's lookup hash only (purged after 30 days). Attachments and the raw message are never stored. |
| **Open operator step** | Ask Resend whether received mail and logs can be deleted on request or kept for zero days, and record the answer here. |
