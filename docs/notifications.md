# Notifications

Sub-phase 1.6. Two channels, one per audience:

- **The bell** (in-app): a `Notification` row per user and workspace, pushed
  live over server-sent events and listed by the notification routes.
- **Email**: a `NotificationOutbox` row per message, sent later by the outbox
  drain, so a request never waits on a mail relay and a failed send is
  retried.

Copied and edited from inflect-compliance's notification modules at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` and from its
`docs/scheduled-notification-system.md` (`PROVENANCE.md`, "Copied: jobs,
notifications and observability"). Only the work-item kinds are ported; due
reminders arrived in 2.2; the bell UI came with the application shell in 1.7
(`docs/app-shell.md`). Sub-phase 2.7c (owner decisions 132 to 136) added the
Inbox, per-member preferences, the waiting-on email, the daily digest that
replaced 1.6's unwired due digest, retention and Settings → Notifications
(see "The Inbox", "Preferences", "The daily digest" and "Retention" below).
Sub-phase 2.7d (owner decisions 127 to 130) added the mention bell and email
(see "Mentions" below). Sub-phase 2.7e (owner decisions 138 to 142) added
recipient lists and their send-time resolver (see "Recipient lists" below).

## Tables

All four are workspace tables with the usual row-level security
(`tenant_isolation`, `tenant_isolation_insert`, `superuser_bypass`, FORCE) and
a two-workspace test (`tests/integration/notification-tables-isolation.test.ts`;
`tests/integration/notification-preferences.test.ts` for the preferences).

| Table | What | `app_user` |
|---|---|---|
| `Notification` | One bell row: `type`, `title`, `body`, `linkUrl`, `read`, a unique `dedupeKey`; since 2.7c `readAt`, `archivedAt` (the Inbox's Done) and `workItemId` (`(workItemId, tenantId)` → `WorkItem`, `ON DELETE SET NULL ("workItemId")`: a purged item leaves the row and its link). | SELECT, INSERT, UPDATE, DELETE |
| `NotificationPreference` | 2.7c: one row per member and type (`@@id([tenantId, userId, type])`): `inApp`, `emailDelivery` (`OFF`, `IMMEDIATE`, `DAILY`; a CHECK allows `IMMEDIATE` only for `WORK_ITEM_ASSIGNED`, `WORK_ITEM_WAITING_ON` and, since 2.7d, `WORK_ITEM_MENTIONED`). `(tenantId, userId)` → `TenantMembership`, cascade: a removed member's rows go. No row is the type's default. | SELECT, INSERT, UPDATE, DELETE |
| `NotificationOutbox` | One email: recipient, subject, text and HTML body, `status` (`PENDING` / `SENT` / `FAILED`), `attempts`, `sendAfter`, `lastError`, a unique `dedupeKey`. | SELECT, INSERT, UPDATE |
| `TenantNotificationSettings` | Per workspace: email on or off, sender name and address, a BCC mailbox, the muted bell types. | SELECT, INSERT, UPDATE |

The outbox and the settings row are never deleted by the application; a
workspace purge cascades as the table owner. The outbox's `toEmail` is
personal data and is encrypted in place by the PII extension
(`src/lib/security/pii-middleware.ts`); `subject`, `bodyText` and `bodyHtml`
are classified not-sensitive in `tests/guards/encryption-manifest-coverage.test.ts`
(they are generated from templates, and the drain must read them to send).

The bell's column is `body`, not inflect's `message` (ADR 0006 bans the word
in identifiers), and the settings' BCC column is `bccMailbox`, inflect's
`complianceMailbox`.

## The bell

Five writers, all in `src/app-layer/notifications/`:

| Writer | Type | Dedupe key |
|---|---|---|
| `createAssignmentNotification` (`assignment.ts`) | `WORK_ITEM_ASSIGNED`; `WORK_ITEM_WAITING_ON` (2.4b: the person an item now waits on, unless they named themselves) | `tenant:TYPE:item:user:YYYY-MM-DD` |
| `createWatcherNotifications` (`watcher.ts`) | `WORK_ITEM_WATCH_UPDATE` | per watcher, item, kind, discriminator and day |
| `createWorkItemDueNotification(s)` (`work-item-due.ts`, 2.2) | `WORK_ITEM_DUE` | `tenant:WORK_ITEM_DUE:window:item:user:YYYY-MM-DD` (the run day in `NOTIFICATIONS_TZ`) |
| `createMentionNotifications` (`mention.ts`, 2.7d) | `WORK_ITEM_MENTIONED` (a person newly mentioned in a comment or a description, never the author) | `tenant:WORK_ITEM_MENTIONED:item:<commentId or description>:user:YYYY-MM-DD` |
| `createIntakeNotifications` (`intake.ts`, 2.6a) | `INTAKE_REQUEST_RECEIVED` (the project's notify list, never the sender), `INTAKE_REQUEST_WOKEN` (whoever snoozed it) | `tenant:TYPE:request:user` (WOKEN also per wake day); recipients re-checked for `intake.view` ([docs/intake.md](intake.md)) |

Each one, in order:

1. asks `isInAppTypeEnabled` (`settings.ts`) which of its recipients the type
   may ring, and writes no row for the others: not a row, not an event. Since
   2.7c that is each recipient's preference under the workspace's mute list
   (`memberDeliveries`: the settings row and the batch's preference rows, two
   reads for the whole batch, never one per recipient). It is the only check
   a bell writer makes; there is no second path;
2. inserts with `createMany({ skipDuplicates: true })`, so a repeat the same
   day collapses and the caller's transaction is never aborted by a unique
   violation;
3. only when a row was inserted, reads the row's real id back
   (`inserted-ids.ts`) and publishes it to the in-process bus
   (`src/lib/notifications/notification-bus.ts`), filtered by workspace AND
   user. The event carries the row id, which the bell needs to mark it read.

The work-item writers fill `workItemId` (2.7c); the intake bells leave it
NULL.

`in-app-types.ts` lists the mutable types, built from the writers' copy
tables, so a listed type always has a writer that honours its mute
(`tests/unit/notifications/in-app-types.test.ts`). The links are the caller's:
2.3 owns the work-item route and its path helper.

The work-item usecases (sub-phase 2.2, `docs/work-items.md`) call them after
their transaction commits, each in a short transaction of its own, swallowing
errors: an assignment rings the assignee (the email is an outbox row written
inside the transaction; a bulk assign sends one digest); a state change, a
comment, an assignment and a material edit ring the item's ACTIVE watchers,
never the actor; and a due date on the 7, 1 or 0-day window rings the
assignee and the person the item waits on, as does the daily
`work-item-due-notification` job (owner decision 137, 2.7a: the same
`WORK_ITEM_DUE` type and windows, so one mute governs both; the waited-on
person's copy reads "waiting on you"; an unassigned item still rings the
person it waits on; one row when they are the same person; only ACTIVE
members; naming who an item waits on rings today's window for them too). A due date is
date-only: its day is read from the value's UTC date parts and never shifted
by a zone; only "today" is computed in `NOTIFICATIONS_TZ`.

### Routes

| Route | Method | What |
|---|---|---|
| `/api/t/<slug>/notifications` | GET | Without `view`: the caller's own bell rows in this workspace not marked Done, the newest 50 (the bell). With `view=unread\|all\|done` (2.7c): one Inbox page, cursor-paginated (`limit`, `cursor`; docs/pagination.md), optionally of one `type`, with `unreadCount`. |
| `/api/t/<slug>/notifications/<id>` | PUT | Mark one read (body `{}`, the bell's call); a row that is not the caller's is a silent no-op. |
| `/api/t/<slug>/notifications/<id>` | PATCH | 2.7c: `{ read?, done? }`: read or unread, Done or back in the Inbox; Done also marks it read. Another member's row is a silent no-op. |
| `/api/t/<slug>/notifications/bulk` | POST | 2.7c: `{ action: 'mark-all-read' }`, or `{ action: 'update', ids (≤ 200), read?, done? }`; only the caller's rows change. |
| `/api/t/<slug>/notification-preferences` | GET, PUT | 2.7c: the caller's preferences (see "Preferences"). |
| `/api/t/<slug>/notifications/stream` | GET | The SSE stream: subscribes on connect, a heartbeat comment every 25 s, unsubscribes on abort. Node runtime, never cached. |

Every role may read and change its own bell and Inbox (`assertCanRead`); no
route takes a permission key, because nobody acts on anybody else's rows: the
repository filters every read and write by user and workspace
(`tests/integration/notification-per-user-scope.test.ts`).
The stream authenticates at connect only: a session revoked while a stream is
open keeps receiving that user's events until the connection drops (a known
limitation, ADR 0005). The bus is in-process, so with several web processes a
user sees live events only from the process their stream is on; the list is
always complete.

## Email

### Enqueue

`enqueueEmail(db, input)` (`enqueue.ts`) takes a typed payload per
`EmailNotificationType` (`EmailPayloadByType`, exhaustive), builds the
message from its template, and inserts a PENDING outbox row. It skips the
write when the workspace turned email off. The dedupe key is
`tenant:type:hashForLookup(address):entity:day`: the address is hashed, so
the key holds no personal data, and a repeat the same day is skipped without
aborting the caller's transaction
(`tests/integration/notification-enqueue-duplicate-in-transaction.test.ts`).

The member templates, react-email components rendered to HTML with a
plain-text twin (`templates.ts`, `email/`):

- `WORK_ITEM_ASSIGNED`: the assignee's notice.
- `WORK_ITEM_WAITING_ON` (2.7c): the person an item now waits on, and who
  set it.
- `NOTIFICATION_DIGEST` (2.7c): the daily digest (see "The daily digest").
- `WORK_ITEM_MENTIONED` (2.7d): who mentioned the person, on which item, with
  a link; never the text (see "Mentions").

`DUE_DIGEST` is retired (2.7c, owner decision 133): it never had a caller, its
dispatcher and template are gone, and its payload type is `never`, so nothing
can enqueue one. The enum value stays because Postgres cannot drop it.

The immediate emails ask the member's preference first (`emailDeliveryFor`,
the same resolution as the bell's): `enqueueAssignedEmail` (inside the
assigning transaction), the waiting-on email (in the waiting-on bell's
short transaction after the commit) and the mention email (in the mention
bell's, 2.7d, one batch read for its recipients through `memberDeliveries`)
are written only while the choice, under the workspace's email switch, is
`IMMEDIATE` (the default for all three). A DAILY
choice leaves the bell row to the digest.

Every link goes through `appLink` (`app-link.ts`), absolute against
`NEXT_PUBLIC_APP_URL`: a relative link opens nothing in a mail client
(`tests/unit/notification-templates.test.ts`).

### The drain

`processOutbox` (`processOutbox.ts`) reads PENDING rows due now, oldest first,
and for each one:

1. **claims** it with a conditional update that bumps `attempts` and moves
   `sendAfter` forward by a lease (`OUTBOX_CLAIM_LEASE_MS`, 15 minutes), so
   a second pass running at the same time, or the next tick, cannot send it
   again while the first send is in flight;
2. sends it through the mailer, from the workspace's sender and with its BCC
   mailbox;
3. settles it `SENT`, or back to `PENDING` with its original `sendAfter` and
   the error (retried next pass), or `FAILED` on the last attempt
   (`maxAttempts`, 3).

A workspace with email turned off is skipped, not failed. Called without a
workspace it drains every workspace (the scheduled job); with one, only that
workspace (the admin action).

The job `notification-outbox-flush` runs it every ten minutes (see
`docs/jobs.md`).

### Outsiders as recipients (2.6b)

A public intake form's requester is not a member, so no member's
preference or membership applies to them. Four email types are
written for them, each from inside the transaction that decides it, with the
decrypted address passed to `enqueueEmail`: `INTAKE_CONFIRM_ADDRESS` (when
they ask for updates; deduplicated per address and form a day, so one form
cannot be used to mail an address repeatedly), and, only after they confirm
their address, `INTAKE_ACCEPTED`, `INTAKE_DECLINED` (never for spam) and
`INTAKE_MERGED` (deduplicated per request). Each names the form and the
request's short reference, never the text the requester typed, and links
nowhere into the app (the confirmation page is outside it). The workspace's
email switch applies as for every other email. See `docs/intake.md`,
"Public forms (2.6b)".

From 2.6c an emailed request's sender is such a recipient too.
`INTAKE_RECEIVED_ACK`, added in a migration of its own, acknowledges a new
emailed request, only when the sender check is `VERIFIED` (owner decision
123), once per request; it names the reference only and carries a
`Reply-To`: the request's reply address, so the sender's reply threads onto
the request. `NotificationOutbox.replyTo` holds it (our own intake address,
not personal data), and the mailer passes it to nodemailer. A `VERIFIED`
sender's address counts as confirmed, so the accepted, declined and merged
notices reach it; nothing is ever sent to an unauthenticated sender, to an
auto-reply or bounce, or about a follow-up. See `docs/intake.md`, "Inbound
email (2.6c)". Outbound mail goes through Resend's SMTP once an operator
configures it (`docs/deployment.md`, "Email (Resend)").

### Sender address

The `From` header is the workspace's `defaultFromEmail`, and when the
workspace has no settings row, the deployment's `SMTP_FROM`
(`deploymentSenderAddress` in `src/lib/email/sender-identity.ts`, the single
owner of that fallback). With neither, the placeholder
`UNCONFIGURED_SENDER`, an address under the reserved `.invalid` domain, which no relay accepts, so a deployment that
forgot to configure a sender fails loudly. `defaultFromEmail` has no column
default on purpose; `defaultFromName` defaults to `Islestone`
(`tests/unit/notification-sender-fallback.test.ts`,
`tests/integration/notification-settings-column-default.test.ts`).

### The transport

`src/lib/mailer.ts`. With `SMTP_HOST` set, `initMailerFromEnv` (run at start by
`src/instrumentation-node.ts` and the worker, and lazily by the first send of
a module copy nothing initialised) installs the SMTP transport: `nodemailer`
(MIT-0, ADR 0007 E8), port `SMTP_PORT` (587 by default, 465 for implicit TLS),
credentials when both `SMTP_USER` and `SMTP_PASS` are set, and the sender from
`deploymentSenderAddress()`. Its log line names the host, port and sender and
whether credentials are set, never the password.

Without `SMTP_HOST`, mail stays on the console sink: each message is logged,
`sendEmail` reports `delivered: false`, and the drain still claims and settles
rows. Production says so at WARN at start and for every dropped message.

No log line carries a recipient's address, the subject or the body: the mailer
logs the lookup hash of each address (`hashForLookup`, the hash `User.emailHash`
and the dedupe key use) and the template (`recipientLogFields`; owner decision
2026-11-19). `tests/unit/mailer.test.ts` fails if a plain address reaches a log
call.

## Settings

`GET` and `PUT /api/t/<slug>/notification-settings` (`admin.manage`): email
on or off, sender name and address, the BCC mailbox, the muted bell types,
the outbox counts by status, and the list of mutable types. A change is
sanitised (`sanitizePlainText` on the sender name) and audited
(`NOTIFICATION_SETTINGS_UPDATED`).

`POST /api/t/<slug>/notification-settings/run-job` with `{ "jobType": "processOutbox" }`
(`admin.manage`) drains this workspace's outbox now, at most 100 rows, and
writes a `NOTIFICATION_OUTBOX_PROCESSED` audit entry with the counts.

Settings → Notifications (`/t/<slug>/settings/notifications`, 2.7c, owner
decision 136) is the page over these routes: the email switch, the sender,
the BCC mailbox, the in-app mutes, the outbox counts and "Send queued email
now". It is behind the Settings gate (`settingsPageAccess`), and offers the
settings only to a caller the API admits (`mayManageNotificationSettings`,
asked on the server: `admin.manage` and the admin tier); anybody else is told
so and nothing is read. These settings are the ceiling members' preferences
show.

## The Inbox (2.7c)

`/t/<slug>/inbox` (owner decision 134; `src/components/inbox/`): the member's
own notifications as the tabs Unread, All (not Done) and Done (ADR 0006: Done
is the Inbox's archive verb), optionally of one kind, newest first, with
"Load more". Each row opens (marking it read and following its link), is
marked read or unread, and is marked Done, or on the Done tab moved back;
Done goes through the undo toast (`SITE_CONTRACTS` in
`tests/guards/undo-toast-coverage.test.ts`). "Mark all read" clears the
unread count. While focus is in the list, J and K move the selection, E marks
it Done and U toggles read (`useKeyboardShortcut` with `within`: a bare key is
never bound for the whole page). The bell's list leaves Done rows out, and its
"View all" link opens the Inbox.

## Preferences (2.7c)

Owner decision 132. Per member and notification type, the bell on or off and
email off, at once or in the daily digest. One client-safe module holds the
rules, `src/lib/notifications/preferences.ts`:

- `PREFERENCE_TYPES`: the types a bell writer emits (held equal to
  `listInAppNotificationTypes`); `GENERAL` has no row.
- `PREFERENCE_DEFAULTS`, exhaustive over `NotificationType`: the bell on for
  every type; email `IMMEDIATE` for assigned, waiting on and mentions,
  `DAILY` for due dates and watched items, `OFF` for intake.
- `IMMEDIATE_EMAIL_TYPES`: assigned, waiting on and, since 2.7d, mentioned
  (the CHECK, widened in `20261205120200_mentions`, holds the same list).
- `resolveDelivery`: the member's row (or the default) under the workspace's
  `TenantNotificationSettings`, the ceiling: a type the workspace muted rings
  nobody, and with its email switch off nobody is mailed. A member's choice
  only narrows. The digest lists a type's unread bell rows, so `DAILY` with
  the bell off sends nothing (`BELL_OFF`), except for due dates, which the
  digest reads from the items (`DIGEST_READS_ITEMS`).

`GET /notification-preferences` returns one row per type: the choice, whether
it is the default, what the writers do, the cap and its reason, and the email
choices the type offers. `PUT { rows }` changes some types, or `{ type, reset:
true }` returns one to its default (its row is deleted); `IMMEDIATE` where it is
not offered is a 400 `IMMEDIATE_NOT_OFFERED`, `DAILY` with the bell off a 400
`DAILY_NEEDS_IN_APP`; a change is audited `NOTIFICATION_PREFERENCES_UPDATED`
with the changed types, before and after. The page is
`/t/<slug>/inbox/preferences`: the grid from the server, a capped cell
disabled with its reason.

## The daily digest (2.7c)

Owner decision 133. The job `notification-digest`
(`src/app-layer/jobs/notification-digest.ts`) runs at 08:10 in
`NOTIFICATIONS_TZ`, after the 08:00 due bells. For each LIVE workspace (a
soft-deleted one keeps its memberships, so it resolves the live workspaces
itself: `tests/guards/cross-tenant-recipient-liveness.test.ts`) whose email is
on, for each ACTIVE member with something `DAILY`, in pages of 200 members, it
writes one `NOTIFICATION_DIGEST` email through `enqueueEmail` with:

- their open work items due soon (overdue, today, or within `DUE_SOON_DAYS`),
  assigned to them or waiting on them, when their due-date email is `DAILY`;
- the unread notifications still in their Inbox, created in the last 24
  hours, of the other types they receive daily (the due bells are never
  listed: the due section replaces them).

Everything is re-checked when the digest is built: the item is live, in a live
and unarchived project, and visible to the member's role
(`resolveProjectVisibility`; a GUEST sees none until 8.4); a notification
whose item is gone is dropped; an intake notification goes only to a member
who still holds `intake.view`. Each section shows at most 50 lines and counts
the rest. The email carries keys, titles, due dates and the bell rows' stored
copy, never a description or a comment. It is deduplicated per workspace,
address and day (`enqueueEmail`), so a retry mails nobody twice
(`tests/integration/notification-digest.test.ts`).

## Mentions (2.7d)

Owner decisions 128 and 130 ([docs/work-items.md](work-items.md), "Mentions
(2.7d)"). A person's own comment or description that newly mentions an
active member who can see the project records a `Mention` row in the write's
transaction; after the commit `emitMentionBells` (`work-item-shared.ts`)
rings them, never the author, in one short transaction:

- the bell, `WORK_ITEM_MENTIONED`, through `createMentionNotifications`
  (`mention.ts`), which asks `isInAppTypeEnabled` first like every writer:
  "Ada Lovelace mentioned you in a comment on ISL-12 "Title"." (or "in the
  description of"), linked to the item;
- the email, `WORK_ITEM_MENTIONED` (`email/work-item-mentioned.tsx`), when the
  person's mention preference resolves to `IMMEDIATE` (the default), deduped
  per address, source and day by `enqueueEmail`; with `DAILY` the bell row is
  listed in the digest instead.

Neither carries the comment's or the description's text (decision 130):
both are encrypted, and the bell's `body` and the outbox are plaintext. The
comment's watcher fan-out skips the people it just mentioned, who were added
as watchers in the same write (decision 128), so they get one notification,
not two. Machine-made text (intake accept, templates, repeat copies) records
and rings nobody (decision 129).

## Recipient lists (2.7e)

Owner decisions 79 and 138 to 142 (ADR 0006 "Recipient list"; the map
`docs/porting/maps/2.7.md`, part 6). A recipient list is a named set of people
to notify: the workspace's (`RecipientList.projectId` NULL) or one project's,
its people in `RecipientListMember` (each an ACTIVE member when added; the
membership FK cascades, so a removed member leaves every list). Lists are
archived and restored, never deleted (decision 141; `app_user` holds no
DELETE on them). Migration `20261206120000_recipient_lists`.

**One resolver, at send time.** `resolveListRecipients(db, tenantId, { listIds,
projectId?, alsoUserIds?, may })` (`src/app-layer/notifications/recipient-list.ts`)
is the only reader of a list for sending; every later feature that names a list
(reviews in 2.8, checklists, notify actions, reports, minutes) calls it. The
stored membership is never "may receive": each call re-checks that the
workspace is live (it is a member of the census in
`tests/guards/cross-tenant-recipient-liveness.test.ts`), that the list is
live and the workspace's or the named project's, and, for each person, that
they are an ACTIVE member whose permissions hold what the caller asks (`may`)
and whose role sees the project. Each person is counted once across the lists
and `alsoUserIds`. The bell or email writer then asks the person's own
preference (`isInAppTypeEnabled`, `emailDeliveryFor`), as for every
notification.

Two callers today:

- **An item's watchers** (decision 139). `POST /work-items/:id/watchers/recipient-list
  { listId }` (`work_items.edit`) copies the people the list resolves to (who
  read work items and see the item's project) onto the watchers, as ordinary
  watchers each free to stop watching; the rest are skipped and counted. One
  audit entry, `WORK_ITEM_WATCHERS_ADDED_FROM_LIST`, names the list and the
  people added. Nobody is notified, as adding a watcher notifies nobody.
- **A project's intake** (decision 142). `ProjectIntake.recipientListId` names
  one list beside the notify list's member rows; a new request's
  `INTAKE_REQUEST_RECEIVED` bell rings the union, each person once, who hold
  `intake.view`, never the sender (`notifyIntakeReceived`). An archived list
  rings nobody until it is restored.

## Reviews (2.8a)

Owner decision 161 ([docs/work-items.md](work-items.md), "Reviews (2.8a)"; ADR 0009). Four bell types, written by `createReviewNotifications` / `createReviewNotificationBatch` (`src/app-layer/notifications/review.ts`), which ask `isInAppTypeEnabled` first like every writer and set `workItemId`:

| Type | To | Default |
|---|---|---|
| `WORK_ITEM_REVIEW_REQUESTED` | each reviewer when their step opens, or when they are added to an open one; worded "has no reviewers left" to the assignee and whoever sent the round when a step is left with nobody | bell; email at once |
| `WORK_ITEM_REVIEW_DUE` | the pending reviewers of an open step due today, on the next working day, or overdue (once), from the 08:00 `work-item-due-notification` job | bell; daily digest |
| `WORK_ITEM_REVIEW_RETURNED` | the assignee and whoever sent the round, when a reviewer returns the item | bell; email at once |
| `WORK_ITEM_REVIEW_COMPLETED` | the same people, when a round completes | bell only |

Immediate email is offered for requested and returned: decision 132's `IMMEDIATE_EMAIL_TYPES` and the CHECK `NotificationPreference_immediate_types` gain the two (migration `20261208120600_reviews`). The emails (`EmailNotificationType.WORK_ITEM_REVIEW_REQUESTED`, `WORK_ITEM_REVIEW_RETURNED`; `email/work-item-review.tsx`) go to a person whose preference resolves to `IMMEDIATE`, deduped per address, step and day. After the commit `emitReviewNotices` (`work-item-shared.ts`) rings them; nobody is told of their own act, and a response then fans out to the watchers (kind `reviewed`), skipping the people the review bells reached. The bells and emails name who, which item and which step; never the response text (decision 157).

The reminders are deduplicated per window, step and person (a step's due day is fixed when it opens): ACTIVE members whose role sees the project, live items in live, unarchived projects, in pages of 500. The digest lists the day's unread review rows of a member's daily types, like the other work-item types.

## Calendar changes not applied (3.3c)

Owner decisions 227 and 230 ([docs/calendar-sync.md](calendar-sync.md), "The read-back"; ADR 0011 §1). One bell type, `CALENDAR_CHANGE_NOT_APPLIED` (migration `20261219120000_notification_type_calendar_change`, alone), written by `createCalendarChangeNotAppliedNotification` (`src/app-layer/notifications/calendar-change.ts`), which asks `isInAppTypeEnabled` first like every writer: to the member whose moved calendar day was not applied (a stale change, a refused edit, a moved milestone event). It names the item's key (and sets `workItemId`) or the milestone's name and links to it; never text. **In-app only, never email**: `IN_APP_ONLY_TYPES` in `src/lib/notifications/preferences.ts` (the default `{ inApp: true, email: 'OFF' }`, `emailChoicesFor` offers OFF alone, `choiceRefusal` answers 400 `EMAIL_NOT_OFFERED`, `resolveDelivery` never mails it) and the CHECK `NotificationPreference_in_app_only_types` (migration `20261219120100_calendar_read_back`). One per synced event and changed day (the dedupe key carries the event's client id and the day). The workspace may mute it like any listed type (`in-app-types.ts`).

## Timesheets (3.4c)

Owner decision 276 ([docs/time-tracking.md](time-tracking.md), "Timesheets (3.4c)"; ADR 0012 §8). Four bell types, each alone in its migration (`20261222120000` to `20261222120300`), written by `createTimesheetNotifications` (`src/app-layer/notifications/timesheet.ts`), which asks `isInAppTypeEnabled` first like every writer; no row names a work item (`workItemId` NULL):

| Type | To | Default |
|---|---|---|
| `TIMESHEET_SUBMITTED` | whoever approves weeks: the people of the settings' workspace recipient list who hold `time.approve` (`resolveListRecipients`), else every ACTIVE holder of `time.approve`, at most 50; never the week's person; links to the Timesheets page | bell only |
| `TIMESHEET_RETURNED` | the person, when an approver returns their week or reopens an approved one ("Timesheet reopened"); links to their week | bell; email at once |
| `TIMESHEET_APPROVED` | the person, when their week is approved | bell only |
| `TIMESHEET_REMINDER` | while approval is on, every ACTIVE member holding `time.track` who recorded time last week and has not submitted it, from the `timesheet-reminder` job (Mondays 09:20 in `NOTIFICATIONS_TZ`), once per person and week | bell only |

Immediate email is offered for a returned week: `IMMEDIATE_EMAIL_TYPES` and the CHECK `NotificationPreference_immediate_types` gain it (migration `20261222120500_timesheets`); the email (`EmailNotificationType.TIMESHEET_RETURNED`, alone in `20261222120400`; `email/timesheet-returned.tsx`) names the week and who, deduped per address, week row version and day. After the commit `emitTimesheetNotices` (`usecases/timesheet.ts`) rings them; nobody is told of their own act. The bells and the email never carry the explanation's text. A decision rings once per version of the week's row. The digest lists a member's daily timesheet rows, the submitted ones only while they still hold `time.approve` and their own week's while they still hold `time.track`.
## Time off changed for you (3.5a)

Owner decision 300 ([docs/workload.md](workload.md); ADR 0013 §8). One bell type, `TIME_OFF_CHANGED_BY_OTHER` (migration `20261223120000_notification_type_time_off`, alone), written by `createTimeOffChangedNotification` (`src/app-layer/notifications/time-off.ts`) after the commit of a time-off write whose writer (a holder of `workload.manage`) is not the person, asking `isInAppTypeEnabled` first like every writer. It names who and the dates ("Ana recorded time off for you on 7 Dec 2026.", "Ana removed your time off on …"), never the type, and links to the Workload page; `workItemId` is NULL. **In-app only, never email**: `IN_APP_ONLY_TYPES` and the CHECK `NotificationPreference_in_app_only_types` (re-created in migration `20261223120100_workload` naming both in-app-only types). One per write (the request id in the dedupe key). No over-capacity notification exists.

## Retention (2.7c)

Owner decision 135. The nightly `notification-purge` (03:10 UTC) deletes, per
live workspace and as its system user, the notifications marked Done more than
90 days ago and the read ones read more than 180 days ago (from `createdAt`
for a row read before `readAt` existed). Unread rows still in the Inbox are
kept however old. Bounded batches, each with a counts-only audit entry
(`NOTIFICATIONS_PURGED`; `purgeExpiredNotifications` in
`src/app-layer/usecases/notification-retention.ts`).
