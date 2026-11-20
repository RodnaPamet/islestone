# Intake

Sub-phase 2.6, built by [`docs/porting/maps/2.6.md`](porting/maps/2.6.md) under owner decisions 85 to 99 (`docs/HANDOFF.md`), ADR 0006 ("Intake words of sub-phase 2.6") and ADR 0002 ("Consequences": an intake request is not a work item). This page records what 2.6a built (the model, internal forms, Settings → Intake and its form builder, the Intake page with every triage action, the notify list and the two jobs) and what 2.6b added: public forms, their bot defence and limits, and the requester's confirmation and notices (see "Public forms (2.6b)"). Inbound email (2.6c) is not built yet.

## The model

| Table | Holds | Notes |
|---|---|---|
| `ProjectIntake` | Whether a project takes requests | One per project; turned off, never deleted (`app_user` holds no DELETE). Email columns arrive with 2.6c. |
| `IntakeNotifyMember` | A member on a project's notify list | Leaves with the membership (cascade). |
| `IntakeForm` | A form that creates requests in one project | `definitionJson` (validated by `IntakeFormDefinitionSchema`, sanitised: the intro, the fields, the confirmation text and, from 2.6b, the requester rules), `definitionVersion` (increases on every definition change), `version` (`If-Match`), `access` (`MEMBERS`, or `PUBLIC` for anyone with the link while public forms are open), `publicId` (random, about 128 bits: the public link's only content), `publishedAt`, `archivedAt`, `dailyCap` (counted by the public submit). Archived, never deleted. |
| `IntakeRequest` | One entry in intake | `status` (`PENDING`, `SNOOZED`, `ACCEPTED`, `DECLINED`, `MERGED`), `channel` (`INTERNAL_FORM`, `PUBLIC_FORM`; `EMAIL` declared for 2.6c), `title` (plaintext), `body`, `answersJson`, `declineExplanation`, `internalRemark` (encrypted by the manifest, sanitised), `requesterUserId` (a member), `requesterName` and `requesterEmail` (a public requester: personal data, encrypted in place by the PII extension, the address matched through `requesterEmailHash`), `updatesRequested`, `updatesConfirmedAt`, `confirmTokenHash` (global, unique), `formTokenNonce` (unique per workspace), the snooze, the decision and its target (`workItemId`, `mergedIntoWorkItemId`, `mergedIntoRequestId`, plain columns: the target may be purged first). |

Every table has `tenantId`, a tenant-leading index, the four RLS policies, its grant and a two-tenant test (`tests/integration/intake-tables-isolation.test.ts`). Migration `20261125120100_intake_core` adds the CHECKs that keep a request's status and its columns in step (decided when and only when accepted, declined or merged; a snooze date when snoozed; a reason when declined; an item when accepted; exactly one merge target when merged, never itself; an internal request names its requester), each with a catalogue test (`tests/integration/intake-sql-constructs.test.ts`). The two bell types are added by `20261125120000_notification_type_intake`, alone. Sub-phase 2.6b's `20261127120100_intake_public` adds the requester's columns and the CHECKs that keep them in step with the channel (a public request names its form; a member's request carries no outsider's details and no form token; an address always has its hash; updates are asked for, and confirmed, only with an address), and `20261127120000_email_type_intake` adds the four requester email types, alone.

## Forms

A form always asks for a title and a description; its own fields follow, of eight kinds (short text, long text, choice, choices, date, number, web address, checkbox), each with a label, optional help, required or not, a choice's options, and optionally the project custom field it fills on accept (`FIELD_KIND_FILLS`). `compileIntakeRequestSchema(definition)` (`src/lib/intake/form-definition.ts`, client-safe) is the one schema of a request: the form page validates with it through react-hook-form's `zodResolver`, and the send's usecase parses with it, so a field is refused at its own input for the reason the server refuses it.

A form takes requests from members while it is published, not archived, for members, in a visible, live, unarchived project whose intake is on (`formIsOpen`). Anyone who sees the project may send a request through it (`projects.view`): the Forms page (`/forms`) lists the open forms and a form's page (`/forms/<id>`) shows it, then its confirmation text and a short reference. A form that is not open is a 404, whatever the reason.

Each answer is stored as a snapshot of its field (`fieldId`, `label`, `kind`, `customFieldId`, `value`), so a later edit of the form never changes what an old request shows.

## Triage

The Intake page (`/intake`, every visible project's; `/projects/<prefix>/intake`, one project's) lists requests by view (New, Snoozed, Spam, Decided) beside the selected one (`?request=<id>`, the bell's link). The actions are the server's `intakeAffordances`:

| Action | From | What it does |
|---|---|---|
| Accept | New, Snoozed | Creates the work item through `createWorkItemInTx` (the create path's core: its rules, audit, automation event and assignment email) in the same transaction as the request's claim, in a Backlog or Unstarted state, in the request's project or another the person may create items in. Answers fill the project's live custom fields when they can (a choice by its option's name); the rest are appended to the description as "Label: value" lines (`planAcceptedFields`). The requester, and the requesters of requests merged into this one, become watchers. The create's bells ring after the commit. |
| Decline | New, Snoozed | A reason (Not planned, Out of scope, Spam, Other), an explanation for a public requester (not kept for spam; emailed to a requester who confirmed their address, see "Public forms (2.6b)") and an internal remark. Spam shows under the Spam view. |
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

A new request rings each member on the project's notify list who holds `intake.view`, never its sender (`INTAKE_REQUEST_RECEIVED`); a woken request rings whoever snoozed it while they still hold `intake.view` (`INTAKE_REQUEST_WOKEN`, one per wake day). Both writers (`src/app-layer/notifications/intake.ts`) ask the workspace's mute list first and are listed by the settings API. The sidebar's Intake entry shows the count of new requests in the visible projects (`GET /intake/requests/count`, read every minute) to readers of intake only. A member who sent a request is made a watcher of the item it becomes; a public requester is emailed only as "Public forms (2.6b)" describes.

## Public forms (2.6b)

Owner decisions 86, 88, 89 and 98. A form whose access is `PUBLIC` takes requests from anyone with its link, `/f/<publicId>`, with no session.

**The switch.** `INTAKE_PUBLIC_FORMS` (`isPublicIntakeOpen`, `src/lib/intake/public-switch.ts`): `1` opens public forms, `0` closes them; unset, they are closed in production and open elsewhere, as public sign-up is. Closed, every public page, submit and confirmation answers the one 404 below, and no form can be made public (409 `PUBLIC_FORMS_CLOSED`). An operator opens it once the release runs on both images (`deploy/.env.prod.example`).

**Resolution without disclosure.** `resolvePublicIntakeForm` (`src/app-layer/usecases/intake-public.ts`) reads one narrow row by the global unique `publicId` under `runWithoutRls({ reason: 'public-intake-resolve' })`, the surface's only bypass, and answers `null` for an unknown or malformed id, a members' form, an unpublished or archived form, an archived or deleted project, a project with intake off, a deleted workspace, and public forms closed. Every caller turns `null` into the same 404 (`publicFormNotFound`). Everything after the resolution runs in `runInTenantContext` for the workspace it found, as its system user: a request from outside is written for nobody. The page renders only the form's own published text; it names no workspace, project or member, and it never reads the session (`tests/guards/public-intake-boundary.test.ts` holds the public modules to `intake-public.ts` and no session read, and the bypass reason to that one file).

**The routes.** `POST /api/intake/forms/<publicId>` (the submit) and `POST /api/intake/confirm` (the confirmation) are `MACHINE_CALLER_PREFIXES` entries, POST only, each gated by its function in `src/lib/intake/public/http.ts` (`acceptPublicIntakeRequest`, `confirmRequesterAddress`; the contracts are in `tests/guards/machine-caller-paths-self-authenticate.test.ts`). `/f/` is a public page prefix.

**Bot defence and limits** (all in-house, decision 88):

| Layer | What it does |
|---|---|
| Signed form token | The page embeds `v1.<definitionVersion>.<issuedAt>.<nonce>.<mac>` (HMAC under `deriveSubkey('islestone-intake-form-token-v1')`, `src/lib/intake/public/form-token.ts`). The submit refuses one older than a day, younger than three seconds, for another form or altered (400 `FORM_TOKEN_REFUSED`), and one for an older version of the form (409, "reload"). Its nonce is stored in `formTokenNonce`, unique per workspace, so a token makes one request: a replay fails inside the insert's own transaction (409). |
| Proof-of-work | SHA-256 of `<token>:<counter>` with 14 leading zero bits (`src/lib/intake/pow.ts`), solved by the page with WebCrypto while the person types, in batches that yield to the page (no worker and no third-party script, so the Content-Security-Policy is unchanged). |
| Trap | A field off screen and out of the tab order, labelled "Leave this field empty". Filled, the submit answers the success screen and stores nothing. |
| Edge | The middleware meters `/f/<publicId>` and the submit at `intakeform:<publicId>` and the confirmation at `intakeconfirm`, every method, at the read tier's budget (120/min), before the allowlist returns (`publicIntakeRateKey`). |
| Handler | 5 a minute and 30 an hour per IP and form (`INTAKE_PUBLIC_SUBMIT_LIMIT`, `INTAKE_PUBLIC_SUBMIT_HOURLY_LIMIT`); 10 a minute per IP for the confirmation (`INTAKE_CONFIRM_LIMIT`). |
| Daily caps | The form's `dailyCap` (default 200) and 2,000 public requests per workspace, each over the last 24 hours, counted from `IntakeRequest` rows under the form's row lock (the in-memory limiter forgets on every deploy, decision 50). Past either, 429 "This form is not taking requests right now". |
| Request hygiene | `application/json` only (415); `Sec-Fetch-Site: cross-site` refused (403); the body read through a capped stream, 64 KB for the submit and 4 KB for the confirmation (413 before parsing, `src/lib/intake/public/capped-body.ts`); the form's own compiled schema; every text sanitised, control and bidirectional-override characters removed from the title. |

**The requester** (decision 89). A form's requester rules ask for a name and an address, each off, optional or required (`compilePublicIntakeRequestSchema`). After sending, the page shows the form's confirmation text and the request's short reference (`intakeReference`: the id's last eight characters). Ticking "Email me about this request" beside an address sends one `INTAKE_CONFIRM_ADDRESS` email, at most one per address per form per day (the outbox's dedupe entity is the form), linking to `/f/confirm/<token>`. That page confirms nothing until its button POSTs the token (mail scanners follow links); the token is 256 bits, stored as its SHA-256, single use, valid for seven days. Confirming confirms the address on that form: the link's request and the address's other requests on the form that asked for updates, and an address confirmed once on a form is not asked again there. After confirmation, a decision emails the requester from inside its transaction (`enqueueRequesterNotices`): `INTAKE_ACCEPTED` (also to the requests merged into an accepted one), `INTAKE_DECLINED` with the reason and the explanation the triager wrote (never for spam), `INTAKE_MERGED`; a decision made before the confirmation is sent when it comes. Snoozing sends nothing. Every requester email names the form and the reference only, never the title, text or answers typed (`src/app-layer/notifications/email/intake-requester.tsx`), and links nowhere into the app.

**In the app.** Settings → Intake offers "Anyone with the link" in the builder only while public forms are open (or to turn a public form back), the requester rules for a public form, a preview rendered by the public page's own form, and a copy-link button for a published public form. The Intake page shows a public request's requester, address and whether they confirmed updates.

**Audit.** `INTAKE_REQUEST_RECEIVED` (channel `PUBLIC_FORM`, as the system user, with `updatesRequested` and whether the address was confirmed before) and `INTAKE_REQUEST_REQUESTER_CONFIRMED` name ids and booleans only, never a name, address, title, text or answer.

**Not in 2.6b.** Blocked senders and "decline as spam and block" (the map's `IntakeBlockedSender`) arrive with 2.6c's email intake, which needs them most; embedding a form in another site (decision 86: a link, never an embed); a status page for the requester (decision 89).

## Jobs

`intake-snooze-wake` (08:05 in `NOTIFICATIONS_TZ`) and `intake-purge` (02:50 UTC), both as the workspace system user, over the workspaces that have a snoozed or a decided request (deleted ones skipped), in batches of 500, each batch its own transaction and a counts-only audit entry. The purge removes decided requests 90 days after the decision and spam 7 days after (`INTAKE_PURGE_DAYS`, `INTAKE_SPAM_PURGE_DAYS` in `src/app-layer/domain/intake.ts`); the work item an accepted request became is untouched. See `docs/jobs.md`.
