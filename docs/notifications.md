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
reminders arrive in 2.2 and the per-user preference page in 2.7; the bell UI
came with the application shell in 1.7 (`docs/app-shell.md`).

## Tables

All three are workspace tables with the usual row-level security
(`tenant_isolation`, `tenant_isolation_insert`, `superuser_bypass`, FORCE) and
a two-workspace test (`tests/integration/notification-tables-isolation.test.ts`).

| Table | What | `app_user` |
|---|---|---|
| `Notification` | One bell row: `type`, `title`, `body`, `linkUrl`, `read`, a unique `dedupeKey`. | SELECT, INSERT, UPDATE, DELETE |
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

Four writers, all in `src/app-layer/notifications/`:

| Writer | Type | Dedupe key |
|---|---|---|
| `createAssignmentNotification` (`assignment.ts`) | `WORK_ITEM_ASSIGNED`; `WORK_ITEM_WAITING_ON` (2.4b: the person an item now waits on, unless they named themselves) | `tenant:TYPE:item:user:YYYY-MM-DD` |
| `createWatcherNotifications` (`watcher.ts`) | `WORK_ITEM_WATCH_UPDATE` | per watcher, item, kind, discriminator and day |
| `createWorkItemDueNotification(s)` (`work-item-due.ts`, 2.2) | `WORK_ITEM_DUE` | `tenant:WORK_ITEM_DUE:window:item:user:YYYY-MM-DD` (the run day in `NOTIFICATIONS_TZ`) |
| `createIntakeNotifications` (`intake.ts`, 2.6a) | `INTAKE_REQUEST_RECEIVED` (the project's notify list, never the sender), `INTAKE_REQUEST_WOKEN` (whoever snoozed it) | `tenant:TYPE:request:user` (WOKEN also per wake day); recipients re-checked for `intake.view` ([docs/intake.md](intake.md)) |

Each one, in order:

1. asks `isInAppTypeEnabled` (`settings.ts`) and writes nothing when the
   workspace muted the type: not a row, not an event;
2. inserts with `createMany({ skipDuplicates: true })`, so a repeat the same
   day collapses and the caller's transaction is never aborted by a unique
   violation;
3. only when a row was inserted, reads the row's real id back
   (`inserted-ids.ts`) and publishes it to the in-process bus
   (`src/lib/notifications/notification-bus.ts`), filtered by workspace AND
   user. The event carries the row id, which the bell needs to mark it read.

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
assignee, as does the daily `work-item-due-notification` job. A due date is
date-only: its day is read from the value's UTC date parts and never shifted
by a zone; only "today" is computed in `NOTIFICATIONS_TZ`.

### Routes

| Route | Method | What |
|---|---|---|
| `/api/t/<slug>/notifications` | GET | The caller's own bell rows in this workspace, the newest 50. |
| `/api/t/<slug>/notifications/<id>` | PATCH | Mark one read; a row that is not the caller's is a silent no-op. |
| `/api/t/<slug>/notifications/stream` | GET | The SSE stream: subscribes on connect, a heartbeat comment every 25 s, unsubscribes on abort. Node runtime, never cached. |

Every role may read its own bell (`assertCanRead`); the repository filters by
user and workspace (`tests/integration/notification-per-user-scope.test.ts`).
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

Two templates, react-email components rendered to HTML with a plain-text
twin (`templates.ts`, `email/`):

- `WORK_ITEM_ASSIGNED`: the assignee's notice.
- `DUE_DIGEST`: the daily list of due work items. An assignee's digest says
  the items are theirs; an admin's says they are unassigned and why the admin
  is reading it.

Every link goes through `appLink` (`app-link.ts`), absolute against
`NEXT_PUBLIC_APP_URL`: a relative link opens nothing in a mail client
(`tests/unit/notification-templates.test.ts`).

### The digest dispatcher

`dispatchDigest` (`digest-dispatcher.ts`) turns a list of due items into one
digest per recipient and workspace. It mails only an ACTIVE member of the
item's workspace, resolved per workspace (a person active in another
workspace is not mailed this one's items), routes an unassigned item to the
workspace's OWNERs and ADMINs (at most ten), and skips a workspace that is
soft-deleted: memberships survive a delete, so the dispatcher checks liveness
itself (`tests/guards/cross-tenant-recipient-liveness.test.ts`). An item
whose assignee is no longer a member is counted `unroutable`, not mailed.
Its caller, the due-reminder job, arrives in 2.2.

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

A public intake form's requester is not a member, so the digest
dispatcher's membership resolution does not apply. Four email types are
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

`POST /api/t/<slug>/notification-settings/run-job` with `{ "job": "processOutbox" }`
(`admin.manage`) drains this workspace's outbox now, at most 100 rows, and
writes a `NOTIFICATION_OUTBOX_PROCESSED` audit entry with the counts.
