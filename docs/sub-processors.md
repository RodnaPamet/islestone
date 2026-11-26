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

## Google (Google Calendar API)

| | |
|---|---|
| **What it does** | Holds the "Islestone" calendar a member connects to their own Google account, and the events Islestone pushes into it (roadmap 3.3b, `docs/calendar-sync.md`; ADR 0011; owner decision 240). |
| **Data** | The titles, due dates and links of a member's own open items assigned to them, and the names, due dates and links of the milestones of their projects. Each link carries the workspace's address and the item's key, or the project's key and the milestone's id (decisions 226, 227 and 229). Nothing else of the workspace: no description, comment, assignee, watcher, person, label, field value or cycle. |
| **On whose instruction** | The member's, once an Owner or Admin has turned calendar sync on for the workspace and the operator has opened it (`CALENDAR_SYNC`; decisions 234 and 235). |
| **Since** | Roadmap 3.3b. Nothing flows until an operator sets `CALENDAR_SYNC=1` (closed in production by default), an Owner or Admin turns it on and a member connects. |
| **Where it is stored** | In a calendar in the member's own Google account, under that account's terms, visible to anyone the member shares that calendar with. Events are private and free. |
| **What Islestone reads back** | From the Islestone calendar only, and only of the events Islestone created: whether each was deleted, its version and when it ends, read every quarter hour (roadmap 3.3c, decisions 225 and 231). A day the member moved becomes their item's due date as their own edit; nothing else is read, and nothing else of the member's calendar. |
| **What Islestone keeps** | The OAuth token pair (encrypted under the workspace's key, decision 238), the dedicated calendar's id, and per event its id, Islestone's own client id, the date pushed, a hash of what was pushed and the provider's version, and Google's sync token for the read-back. No address of the connected account is stored. |
| **Removal** | Disconnecting, leaving the workspace, the switch turned off: Islestone deletes its events, then the empty calendar, then the token (decision 239). Islestone never revokes the grant at Google (decision 236): a member removes Islestone from their Google account themselves, which also affects signing in with Google. |
| **Open operator steps** | Google's OAuth verification of the `calendar.app.created` scope on the sign-in app (decision 236); register the redirect URI (`docs/deployment.md`, "Calendar sync"). The scope's verification class and whether a pending verification changes the sign-in consent screen were not verified from here (re-check). |

## Microsoft (Microsoft Graph, Outlook calendar)

| | |
|---|---|
| **What it does** | Holds the "Islestone" calendar a member connects in their Microsoft 365 or Outlook account, and the events Islestone pushes into it (roadmap 3.3b, `docs/calendar-sync.md`; ADR 0011; owner decision 240). |
| **Data** | As for Google: titles, due dates and links of the member's open assigned items and their projects' milestones; nothing else. |
| **On whose instruction** | The member's, once an Owner or Admin has turned calendar sync on, the customer directory's administrator has authorised Microsoft 365 (decision 237) and the operator has opened it. |
| **Since** | Roadmap 3.3b, behind `CALENDAR_SYNC` (closed in production by default). |
| **Where it is stored** | In a calendar in the member's own Microsoft account, under their organisation's terms, visible to anyone the member shares it with. Events are private and shown as free. |
| **What Islestone reads back** | From the Islestone calendar only, and only of the events Islestone created: whether each was deleted, its version and when it ends, read every quarter hour (roadmap 3.3c, decisions 225 and 231). A day the member moved becomes their item's due date as their own edit; nothing else is read, and nothing else of the member's calendar. |
| **What Islestone keeps** | As for Google, plus the customer directory's id and who granted the admin consent. |
| **Removal** | As for Google. Withdrawing the consent in Settings → Calendar sync removes every Outlook connection and its events. Microsoft offers no per-grant revoke for a delegated token; tokens are destroyed locally. |
| **Open operator steps** | Microsoft's publisher verification for the multi-tenant sign-in app; register the two redirect URIs (`docs/deployment.md`, "Calendar sync"); the app registration must accept other directories, as sign-in at `common` does. |
