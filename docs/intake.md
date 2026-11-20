# Intake

Sub-phase 2.6, built by [`docs/porting/maps/2.6.md`](porting/maps/2.6.md) under owner decisions 85 to 99 (`docs/HANDOFF.md`), ADR 0006 ("Intake words of sub-phase 2.6") and ADR 0002 ("Consequences": an intake request is not a work item). This page records what 2.6a built: the model, internal forms, Settings → Intake and its form builder, the Intake page with every triage action, the notify list and the two jobs. Public forms (2.6b) and inbound email (2.6c) are not built yet.

## The model

| Table | Holds | Notes |
|---|---|---|
| `ProjectIntake` | Whether a project takes requests | One per project; turned off, never deleted (`app_user` holds no DELETE). Email columns arrive with 2.6c. |
| `IntakeNotifyMember` | A member on a project's notify list | Leaves with the membership (cascade). |
| `IntakeForm` | A form that creates requests in one project | `definitionJson` (validated by `IntakeFormDefinitionSchema`, sanitised), `definitionVersion` (increases on every definition change), `version` (`If-Match`), `access` (`MEMBERS`; `PUBLIC` is refused until 2.6b), `publicId` (random, for 2.6b's link), `publishedAt`, `archivedAt`, `dailyCap` (read from 2.6b). Archived, never deleted. |
| `IntakeRequest` | One entry in intake | `status` (`PENDING`, `SNOOZED`, `ACCEPTED`, `DECLINED`, `MERGED`), `channel` (`INTERNAL_FORM`; `PUBLIC_FORM` and `EMAIL` declared for 2.6b and 2.6c), `title` (plaintext), `body`, `answersJson`, `declineExplanation`, `internalRemark` (encrypted by the manifest, sanitised), `requesterUserId`, the snooze, the decision and its target (`workItemId`, `mergedIntoWorkItemId`, `mergedIntoRequestId`, plain columns: the target may be purged first). |

Every table has `tenantId`, a tenant-leading index, the four RLS policies, its grant and a two-tenant test (`tests/integration/intake-tables-isolation.test.ts`). Migration `20261125120100_intake_core` adds the CHECKs that keep a request's status and its columns in step (decided when and only when accepted, declined or merged; a snooze date when snoozed; a reason when declined; an item when accepted; exactly one merge target when merged, never itself; an internal request names its requester), each with a catalogue test (`tests/integration/intake-sql-constructs.test.ts`). The two bell types are added by `20261125120000_notification_type_intake`, alone.

## Forms

A form always asks for a title and a description; its own fields follow, of eight kinds (short text, long text, choice, choices, date, number, web address, checkbox), each with a label, optional help, required or not, a choice's options, and optionally the project custom field it fills on accept (`FIELD_KIND_FILLS`). `compileIntakeRequestSchema(definition)` (`src/lib/intake/form-definition.ts`, client-safe) is the one schema of a request: the form page validates with it through react-hook-form's `zodResolver`, and the send's usecase parses with it, so a field is refused at its own input for the reason the server refuses it.

A form takes requests from members while it is published, not archived, for members, in a visible, live, unarchived project whose intake is on (`formIsOpen`). Anyone who sees the project may send a request through it (`projects.view`): the Forms page (`/forms`) lists the open forms and a form's page (`/forms/<id>`) shows it, then its confirmation text and a short reference. A form that is not open is a 404, whatever the reason.

Each answer is stored as a snapshot of its field (`fieldId`, `label`, `kind`, `customFieldId`, `value`), so a later edit of the form never changes what an old request shows.

## Triage

The Intake page (`/intake`, every visible project's; `/projects/<prefix>/intake`, one project's) lists requests by view (New, Snoozed, Spam, Decided) beside the selected one (`?request=<id>`, the bell's link). The actions are the server's `intakeAffordances`:

| Action | From | What it does |
|---|---|---|
| Accept | New, Snoozed | Creates the work item through `createWorkItemInTx` (the create path's core: its rules, audit, automation event and assignment email) in the same transaction as the request's claim, in a Backlog or Unstarted state, in the request's project or another the person may create items in. Answers fill the project's live custom fields when they can (a choice by its option's name); the rest are appended to the description as "Label: value" lines (`planAcceptedFields`). The requester, and the requesters of requests merged into this one, become watchers. The create's bells ring after the commit. |
| Decline | New, Snoozed | A reason (Not planned, Out of scope, Spam, Other), an explanation for an outside requester (not kept for spam; sent from 2.6b) and an internal remark. Spam shows under the Spam view. |
| Merge | New, Snoozed | Into a live work item the person can see (by its key), or into another new or snoozed request (never a merged one, never itself). Requests merged into this one follow it to the new target, so no chain forms. |
| Snooze | New, Snoozed | Until a date after today (`NOTIFICATIONS_TZ`). |
| Move | New, Snoozed | To another visible, live project whose intake is on. |
| Edit | New, Snoozed | The title or the text (API only in 2.6a). |
| Reopen | Snoozed, Declined, Merged | Back to New; an accepted request never reopens (its item exists). |

Every action locks the request row, checks the status (`checkTriage`, `src/app-layer/domain/intake.ts`) and the version the person read (`If-Match`, required: 428 without, 409 `VERSION_CONFLICT` with the current request), then claims it with one `updateMany` naming the statuses it starts from and that version. Two people deciding at once make one decision (`tests/integration/intake.test.ts` races two accepts). A merge into a request locks both rows in id order first.

Audit entries name ids, the channel and codes, never a title, text or answer: `INTAKE_REQUEST_RECEIVED`, `_ACCEPTED`, `_DECLINED`, `_MERGED`, `_SNOOZED`, `_MOVED`, `_UPDATED`, `_REOPENED`, `INTAKE_REQUESTS_WOKEN`, `INTAKE_REQUESTS_PURGED`, `INTAKE_FORM_CREATED`, `_UPDATED`, `_PUBLISHED`, `_UNPUBLISHED`, `_ARCHIVED`, `_RESTORED`, `PROJECT_INTAKE_UPDATED`. The accepted item's `WORK_ITEM_CREATED` entry carries `intakeRequestId` and `intakeChannel`. The automation stub receives `INTAKE_REQUEST_RECEIVED` (inside the send's transaction) and `INTAKE_REQUEST_DECIDED` (after a decision's commit).

## Who may do what

The `intake` domain of the `PermissionSet` (owner decision 92): `intake.view` (read requests and forms) and `intake.triage` for Owners, Admins and Members; `intake.manage` (turn intake on, the notify list, forms) for Owners and Admins; none for Viewers and Guests. Accepting also needs `work_items.create`. A custom role saved before the domain existed reads it from its base role. Every route is a literal `requirePermission` with a rule in `route-permissions.ts`; `tests/integration/intake-api.test.ts` drives every route as each role, and `tests/guards/tenant-crud-authz-coverage.test.ts` pins each key.

## Settings → Intake

`/settings/intake`, behind the Settings page's own gate (`mayOpenSettings`), offering the writes `intakeAffordances().manage` allows: per project, intake on or off (the first switch-on puts its author on the notify list, decision 95), the notify list (active members only), and the forms, built in `IntakeFormBuilder` (react-hook-form's `useFieldArray`; fields moved up or down by buttons; a preview rendered by the form page's own component), published, unpublished, archived and restored.

## Notifications

A new request rings each member on the project's notify list who holds `intake.view`, never its sender (`INTAKE_REQUEST_RECEIVED`); a woken request rings whoever snoozed it while they still hold `intake.view` (`INTAKE_REQUEST_WOKEN`, one per wake day). Both writers (`src/app-layer/notifications/intake.ts`) ask the workspace's mute list first and are listed by the settings API. The sidebar's Intake entry shows the count of new requests in the visible projects (`GET /intake/requests/count`, read every minute) to readers of intake only. Nothing is sent to a requester in 2.6a beyond being made a watcher of the accepted item: outsiders' confirmed email notices are 2.6b's.

## Jobs

`intake-snooze-wake` (08:05 in `NOTIFICATIONS_TZ`) and `intake-purge` (02:50 UTC), both as the workspace system user, over the workspaces that have a snoozed or a decided request (deleted ones skipped), in batches of 500, each batch its own transaction and a counts-only audit entry. The purge removes decided requests 90 days after the decision and spam 7 days after (`INTAKE_PURGE_DAYS`, `INTAKE_SPAM_PURGE_DAYS` in `src/app-layer/domain/intake.ts`); the work item an accepted request became is untouched. See `docs/jobs.md`.
