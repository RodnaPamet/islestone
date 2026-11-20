# Work items

Sub-phases 2.1 (the model) and 2.2 (usecases, API and activity), built by [`docs/porting/maps/2.1-2.2.md`](porting/maps/2.1-2.2.md) under [ADR 0002](adr/0002-work-item-model.md) (the model), [ADR 0003](adr/0003-assignee-and-delegate.md) (the assignee) and [ADR 0006](adr/0006-vocabulary.md) (the names). This page records the design and the decisions taken while building it; the ADRs hold the reasons.

## The model (2.1)

| Table | Holds | Notes |
|---|---|---|
| `Team` | A group of members that owns a workflow | Deleting one is refused while it has projects. |
| `WorkflowState` | One step of a team's workflow, in one of five categories | The category never changes (trigger `workflow_state_category_immutable`). One default per team (partial unique). A team keeps a live DONE and a live CANCELLED state. |
| `Project` | A body of work of one team, with its key prefix | The team is fixed for life in 2.1 (`PROJECT_TEAM_FIXED`). Soft delete and archive (below). |
| `ProjectKeyPrefix` | Every prefix a project has had | Primary key `(tenantId, prefix)`: a prefix is never reused. |
| `ProjectKeySequence` | A project's key counter | Incremented by `INSERT … ON CONFLICT DO UPDATE` in the item's transaction: contiguous numbers, and a failed create uses none. |
| `WorkItemType` | A workspace-configured kind | Feature, Bug and Chore are seeded the first time a workspace creates a team or a project. |
| `WorkItem` | The single unit of work | Key = prefix + `number`. Sub-items through `parentId`. |
| `WorkItemKeyAlias` | The old key of an item that moved project | Old keys keep resolving. |
| `WorkItemRelation` | BLOCKS, RELATES, DUPLICATES | See "The graph". |
| `Label`, `WorkItemLabel` | Workspace or team labels, and their attachment | A label being deleted refuses attaches (409). |
| `Comment` | A person's comment | Body encrypted and sanitised; edit and soft delete. |
| `WorkItemWatcher` | A member watching an item | Cascades away with the membership. |
| `WorkItemLink` | A URL, pull request or commit (pages and canvases from 4.1/4.2) | `type` and `location`: ADR 0006 bans "Kind" and "Target" in the schema, so the ADR sketch's names were changed. |

Every table has `tenantId`, a tenant-leading index, the four RLS policies, its grant, and a two-tenant test (`tests/integration/work-tables-isolation.test.ts`). The key bookkeeping (`ProjectKeyPrefix`, `ProjectKeySequence`, `WorkItemKeyAlias`) has no foreign key to what the purge removes and `app_user` holds no DELETE on it: numbers and prefixes are never reused.

### Constraints in SQL

Migration `20261119160100_work_core` holds what Prisma cannot declare, each with a catalogue test (`tests/integration/work-item-graph.test.ts`, "SQL constructs"):

- `COLLATE "C"` on every `sortKey`, so Postgres orders keys byte-wise, as JavaScript `<` does;
- the parent link `(parentId, projectId, tenantId) → WorkItem(id, projectId, tenantId)`, `NO ACTION DEFERRABLE INITIALLY DEFERRED` (Postgres defers only NO ACTION checks), so a move rewrites a subtree in one transaction;
- `CHECK (fromId <> toId)`, `CHECK (type <> 'RELATES' OR fromId < toId COLLATE "C")`, the one-duplicate partial unique, the one-default-state partial unique and the workspace-label-name partial unique;
- the category trigger.

`npm run db:check-schema-drift` passes with no new residue: `prisma migrate diff` ignores collations, deferrability, CHECKs and partial indexes.

### Composite keys make wrong shapes unrepresentable

Every child references its parent by `(id, tenantId)`. Beyond that (ADR 0002 §10): `(projectId, teamId, tenantId) → Project` (an item's team is its project's), `(stateId, teamId, stateCategory, tenantId) → WorkflowState` (a state of another team, or a stale category, cannot be stored), `(parentId, projectId, tenantId) → WorkItem` (a parent in another project cannot be stored), `(tenantId, assigneeId) → TenantMembership(tenantId, userId)` ON DELETE RESTRICT (ADR 0003: removing a member unassigns their items first, in `removeTenantMember`).

### The relation indexes

ADR 0002's sketch declares `@@unique([tenantId, type, fromId, toId])` and `@@index([tenantId, type, toId])`, which leave both foreign keys third, unindexed under its own §13 rule. Islestone uses `@@unique([tenantId, fromId, type, toId])` and `@@index([tenantId, toId, type])`: the same uniqueness and the same "blocked by" read, with both keys second after `tenantId`. The sketch is marked illustrative.

### Ordering

`sortKey` is a fractional index written in-house (`src/app-layer/domain/fractional-index.ts`, ADR 0002 F1) with property tests. The server computes every key from "after X" or "before Y". Every placement in a project first locks the project's key-sequence row, so two writers never mint the same key into one gap. A key past 64 characters asks the daily `work-item-sortkey-rebalance` to rewrite the project's keys. `sortKey` is not part of `version`.

### The graph

Every write to the BLOCKS graph or to `parentId` takes `lockWorkItemGraph` (`pg_advisory_xact_lock(hashtext('work-item-graph:<tenantId>'))`) FIRST, then checks:

- **BLOCKS:** refused when the target already reaches the source (a recursive `UNION` over every BLOCKS edge, edges to deleted items included, so a restore can never close a cycle). The pure twin, `wouldCreateCycle`, is property-tested; the SQL is proved with a concurrent pair, of which exactly one is refused.
- **DUPLICATES:** an item duplicates at most one item, the original may not itself be a duplicate, and an item others duplicate cannot become one. Marking a duplicate moves it to its team's CANCELLED default.
- **Sub-items:** the parent is live and in the same project, not the item or a descendant, and the moved subtree fits within five levels (owner decision, 2026-11-19).

## Usecases and API (2.2)

Routes live under `/api/t/<slug>/work-items`, `/projects`, `/teams`, `/work-item-types` and `/labels`.

### Who may do what

Work items use 1.4's `work_items.*` keys; delete and restore take `work_items.delete` (OWNER and ADMIN), and the Deleted view takes it too because it is the restore surface. The work configuration is decided by the owner (2026-11-19), kept as built:

- **Teams, workflow states, work item types and labels** are changed under `admin.manage` and read under `projects.view`. They shape every project of the workspace, so admins configure them; a workspace that wants others to configure grants `admin.manage` through a custom role, with no new key to learn. 1.4's `PermissionSet` has no domain for them, and none was added.
- **Projects** use their own keys: `projects.create`, `projects.edit` (rename, re-prefix) and `projects.archive` for archive, unarchive, delete and restore, the one destructive project key.

**Comments** (owner decision, 2026-11-19; `src/app-layer/policies/comment.policies.ts`): only the author edits a comment, because an admin never rewrites someone else's words. The author or a workspace admin deletes one, the admin for moderation; an admin's delete of someone else's comment is audited as `COMMENT_MODERATED`, naming the author, where the author's own is `COMMENT_DELETED`. Both sit behind `work_items.comment`; a refusal past that key is decided in the usecase, which writes the same `AUTHZ_DENIED` entry a `requirePermission` denial writes and answers 403. Every method is a literal `requirePermission` with a rule in `route-permissions.ts`, so a refusal writes an `AUTHZ_DENIED` row; `tests/guards/tenant-crud-authz-coverage.test.ts` pins each key and `tests/integration/work-items-api.test.ts` drives every route as a VIEWER, a MEMBER and a GUEST.

### Optimistic concurrency

`WorkItem.version` starts at 1 and every write that changes what the item shows increases it, labels included; `sortKey` does not. The version check is the `WHERE` of one `updateMany` (`WorkItemRepository.updateVersioned`); when nothing matched, a re-read tells a 404 from a 409, and the 409 carries `{ reason: 'VERSION_CONFLICT', version, item }`. A title or description edit must send `If-Match` (428 without it); single-field changes may omit it (last writer wins, audited).

### Delete, restore and purge

A delete soft-deletes the item and its live sub-items under one new `deletionId`; a restore brings back every row of that deletion, refused while the project is deleted or archived, or while a parent of the group is deleted under another deletion. Reads filter `deletedAt` explicitly at every site (no soft-delete extension is ported); `tests/unit/repositories/work-item-repository-predicates.test.ts` checks each query. The daily `work-item-purge` hard-deletes items and projects deleted more than `WORK_ITEM_PURGE_DAYS` (30) ago, per workspace in batches of 500, and writes one counts-only `WORK_ITEM_PURGED` entry.

### Project visibility

`visibleProjects(ctx)` is every live project for OWNER, ADMIN, MEMBER and VIEWER, and the granted ones for GUEST, which is none until 8.4 adds project grants. An unknown role fails closed. The visibility is a predicate in every repository read and write, never a per-item check. A deleted project hides its items everywhere (list, get, key lookup, metrics, Activity, relations, sub-items, the due job, the fan-out) and every write to them is a 404; its restore brings them back as they were. An archived project's items stay readable, drop out of the default list and the metrics, and refuse writes (`PROJECT_ARCHIVED`, 409).

### Moves

`POST …/move` reorders (`position`), re-parents (`parentId`) or moves to another project (`projectId`). A move takes the whole live subtree in one transaction: each row gets a new number from the destination's sequence and keeps its old key as an alias (`by-key` answers `redirected: true` with the canonical key). To a project of another team, each item's state maps to that team's default state of the same category (a team with none refuses with `NO_STATE_OF_CATEGORY`), and the old team's labels are detached. A sub-item on its own is refused (`SUB_ITEM_MOVE_REFUSED`, owner decision 2026-11-19).

### Activity

An item's Activity merges its `WORK_ITEM_*` audit entries (never the audit extension's per-statement rows) with its live comments, newest first, one keyset page over `(createdAt, id)`, read through the `[tenantId, entityId, createdAt]` index on `AuditLog`. An audit entry names changed fields, never the description's text.

### Notifications

The side-effect order is each path's own, as in inflect-compliance: a create audits, emits the (stubbed, 5.1) automation event and enqueues the assignment mail inside its transaction, then rings the due and assignment bells; a state change audits inside, then after the commit emits the automation event and fans out to watchers. Watcher bells skip the actor and ring only for material changes (state, assignee, due or start date, re-parent, move, comments). Due reminders are in-app (`WORK_ITEM_DUE`): at create, a due-date edit and an assignment, and daily at 08:00 in `NOTIFICATIONS_TZ` for items due today, tomorrow or in seven days; due dates are date-only and are never shifted by a time zone.

### Encryption

`WorkItem.description` and `Comment.body` are in the field-encryption manifest and sanitised with `sanitizePlainText` before they are stored; titles stay plaintext (ADR 0002 §11, search option S1). Adding `Comment.body` exposed a defect in the encryption extension, fixed here: it fanned out by field name at the top level of a write to any model outside the manifest, which sealed `Notification.body` and `TenantCustomRole.description` under the workspace key, outside the rotation sweeps.

## Views (2.3)

Built by [`docs/porting/maps/2.3.md`](porting/maps/2.3.md). The pages are Work items (`/work-items`, every visible item), a project (`/projects/<prefix>`), Projects, each as a list or a board, My Work (below), and an item's page (`/work-items/<key>`; an old key or an id redirects to the current key).

- **Projects** (`src/app/t/[tenantSlug]/(app)/projects/page.tsx`, `src/components/work-items/ProjectsList.tsx`) lists every visible project with its key prefix, team and status, each linking to its work items. Anyone who holds `projects.create` creates a project there, outside Settings (owner decision 57): the server page asks `mayCreateProject(ctx)`, the predicate `createProject` asserts, and hands the list a boolean; the header's Project button opens `ProjectCreateDialog` (`src/components/settings/`), the one dialog Settings → Projects opens too (a team, the first by default, also when the teams arrive after it opened; a name; a key prefix), which posts to `POST /projects`. The new project shows at once and the page's server list is read again (`router.refresh()`). With no team, the dialog says a project needs one and links to Settings → Teams only for a viewer who may open Settings (`useMayOpenSettings`); anyone else is asked to ask an admin.

- **One query, one cache.** The list, every board column and the sub-items read `useWorkItemList` (cursor pages of `GET /work-items` in SWR); the detail, page and sheet alike, reads `useWorkItem` and its sub-resources. A write goes through `useWorkItemMutations` or `useWorkItemCollab`, which put the changed row in every loaded list (`work-item-cache.ts`: out of a list it no longer matches, into one it now matches at its order, in place where the client cannot tell) and then take the server's row, so the server's `sortKey` and `version` win. A list whose first read has not answered yet holds the change and applies it to that answer, never to the empty cache: SWR discards a read a mutation overlaps, so writing at once left a column that was still loading empty for good, and a card dropped into it in no column (issue #41).
- **Writes.** Optimistic, versioned (`If-Match` on every write to the item, its state, assignee and move), serialised per item. A 409 `VERSION_CONFLICT` is retried once with the current version when none of the fields the write changes moved; otherwise every view shows the server's row and the person is told the item changed. Any other refusal puts the previous row back and shows the server's reason. A description edit is never retried (the conflict answer carries no description). Deletes and removals (an item, a comment, a watcher, a label, a relation, a link, a bulk delete) leave the view at once and are sent when the undo toast's window closes.
- **Filters.** The shared filter system, synced to the URL; every option comes from the server page's configuration (`getWorkItemViewConfig`: visible projects, teams, live states, types, labels, and on a project's page its custom fields) or the roster (`GET /users/assignable`), never from the rows a page loaded. Order is manual (`sortKey`) by default; 2.4 adds the other sorts (below).
- **The board.** A project's columns are its team's states, grouped by category; a board over several teams has one column per category, and a drop takes the item to its own team's default state of that category. Lanes group by assignee, priority, type, label or project; a drop into another assignee, priority or type lane changes that field, while label and project lanes are fixed. A drop is `POST …/move { stateId, position }`: the state change and the place beside the neighbour in one transaction (`moveWorkItemOnBoard`), with the state change's audit entry and effects. A long column is virtualised; the cell is the drop target for cards that are not mounted. Keyboard: Space picks a card up, the arrows move it (down past a cell's end enters the next lane when lanes are movable), Space or Enter drops, Escape cancels, and each step is announced in a live region; every card also has a "Move to…" menu.
- **Comments** offer edit and delete from `comment.policies.ts` itself (decision 53), so the page offers exactly what the server allows.
- **My Work** (decision 54; `src/app/t/[tenantSlug]/(app)/my-work/page.tsx`, `src/components/work-items/MyWorkView.tsx`) is four sections, each a `useWorkItemList` read of `GET /work-items` under one filter toolbar: **Assigned to me** (`assigneeId=<me>`), **Created by me** (`createdById=<me>`), **Watching** (`watching=me`, the caller read from the request context on the server; no other value is accepted) and **Due soon** (`assigneeId=<me>&due=soon`: open items overdue or due within `DUE_SOON_DAYS`, 7, counted in whole days from today in `NOTIFICATIONS_TZ`). "Me" is the page's server context user; an item may sit in several sections. Each section shows the count of its loaded rows ("N+" while more pages exist), an empty state and an explicit "Load more" (25 rows a page; stacked sections under load-on-scroll would keep pushing the next one away). Closed categories (DONE, CANCELLED) are hidden unless the category filter names some: a default of My Work only, the Work items and project pages show every category. The sections are lists, in manual order (2.4's sorts are offered on the Work items and project pages, not in My Work's sections); the board stays on the Work items and project pages. The list row carries `createdByUserId`, so a create lands in "Created by me" at once; the watcher set is not on the row, so the caller's own watch or unwatch re-reads the lists filtered by `watching`. No index was added: `[tenantId, createdByUserId, createdAt]`, `WorkItemWatcher [tenantId, userId]` and `[tenantId, assigneeId, stateCategory, dueDate]` serve the three filters.

## Custom fields and saved views (2.4)

Built by [`docs/porting/maps/2.4.md`](porting/maps/2.4.md) on ADR 0002 §7 and ADR 0006 ("Custom field", "View", "Layout"). Nothing was copied: Teable's `packages/` (MIT, at `bd8cfc0`) and Kaneo (MIT) were read for their rules only (`PROVENANCE.md`).

### The tables

| Table | Holds | Notes |
|---|---|---|
| `CustomField` | A field a project defines: name, type, `sortKey`, `archivedAt` | Types `TEXT`, `NUMBER`, `SELECT`, `MULTI_SELECT`, `DATE`, `PERSON`, `URL`, `CHECKBOX`. The type never changes; a field is archived, never deleted, and keeps its values. At most 50 per project. |
| `CustomFieldOption` | A choice of a select field | Archived options stay on the items that hold them and in filters; they are not newly picked. A delete is refused while a value holds one (`OPTION_IN_USE`, the FK is NO ACTION). At most 200 per field. |
| `CustomFieldValue` | One value of one field on one item, in its type's column | `textValue` (TEXT, URL; at most 500 characters), `numberValue` (`Decimal(15, 6)`), `dateValue` (date-only), `boolValue` (only `true`: unchecked is no row), `optionId`, `userId` (a member: a person field holds one person, owner decision 61). One row per item and field; one per option for a multi-select. |
| `SavedView` | A saved scope, filters, swimlanes, sort, layout and visible columns | `visibility` PERSONAL or SHARED; `projectId` NULL is the Work items page; `layout` LIST or BOARD (TIMELINE and CALENDAR are reserved for 3.1 and 3.3 and refused); `configJson` validated by `SavedViewConfigSchema` on every write. |

What migration `20261120120000_saved_views_and_custom_fields` adds beyond Prisma, each with a catalogue test (`tests/integration/custom-fields-and-views.test.ts`): `COLLATE "C"` on both `sortKey`s; the CHECK that exactly the column of `fieldType` is set, the checkbox CHECK and the text cap; the partial uniques (one value per item and field, one row per option for a multi-select); and `WorkItem.priorityRank`, written only by the `work_item_priority_rank` trigger. The value row carries `projectId` under both composite foreign keys (to `WorkItem(id, projectId, tenantId)` with `ON UPDATE NO ACTION`, and to `CustomField(id, type, projectId, tenantId)`): a value can never sit on another project's item or name another type, and a move to another project deletes the moved rows' values first (`moveWorkItemToProject`) or the database refuses it.

**Text values are not encrypted** (ADR 0002 §7): they are filtered and sorted. The field manager says so; long or sensitive text belongs in the description. They are sanitised (`sanitizePlainText`; a URL with `sanitizeUrlText`, then `http`/`https` only) before they are stored, and an audit entry names the field, never the value.

### Writes and who may make them

- **Definitions** take `projects.edit` (owner decision 58: a field is part of its project, so members define fields; read under `projects.view`), on a visible, unarchived project: `GET/POST /projects/:id/custom-fields`, `PATCH …/:fieldId` (rename, reorder by neighbour, archive, unarchive), `POST …/:fieldId/options`, `PATCH/DELETE …/options/:optionId`. Audited `CUSTOM_FIELD_*`.
- **Values** take `work_items.edit`: `PUT /work-items/:id/custom-fields/:fieldId { value }` (`null` clears), or `customFields` on a create. A value write is a single-field change (ADR 0002 §9): `If-Match` is optional, the item's `version` increases, a stale version is a 409 with the current row. Values are parsed per type in `src/app-layer/domain/custom-field.ts`: an option of the field (an archived one only where already held), an ACTIVE member, a finite decimal under 10^9 with six decimals at most, a real calendar date. Removing a member clears their person values and increases those items' versions first (`clearPersonValuesInTx`), as their items are unassigned.
- **Saved views** take the `views.*` keys (`saved-view.policies.ts`): `views.view` reads your own personal views and every shared view whose scope you can see; `views.create` saves a personal one and `views.share` a shared one; only the creator changes or unshares a view (`views.edit`, plus `views.share` for a shared one); a workspace admin (`admin.manage`) may delete someone else's shared view, audited `SAVED_VIEW_MODERATED`, and never edits it (owner decision 59). OWNER, ADMIN and MEMBER hold all four keys; a VIEWER holds `views.view`, `views.create` and `views.edit` but not `views.share` (owner decision 60), so it saves, changes and deletes its own personal views and never saves, shares or changes a shared one; a GUEST holds `views.view`. A refusal past the route's key (a VIEWER saving or switching to a shared view, anyone changing a view that is not theirs) is decided in the usecase, which writes the same `AUTHZ_DENIED` entry a `requirePermission` denial writes and answers 403. `GET/POST /views`, `GET/PATCH/DELETE /views/:id`.

### The list, the board and the detail

- **Rows** carry `customFields` (field id → a string, a number, `YYYY-MM-DD`, `true`, an option id, option ids in option order, or a user id), read in the list's own query.
- **Filters.** `cf.<fieldId>=<op>[:<operand>]` on `GET /work-items`, at most ten: `empty`, `set` and `any:<ids>` (with `none` for "or no value", and `me` for a person) for select, multi-select and person; `is:true|false` for a checkbox; `eq`, `gt`, `gte`, `lt`, `lte` for a number; `eq`, `before`, `after`, `onOrBefore`, `onOrAfter` for a date; `eq`, `contains` for text and URL. A negative condition includes empty values. An unknown field or an operator the type does not take is a 400. On a project's page every live field is a filter in the filter system (options and "No value"; checked or unchecked; "Has a value" or "No value" for the rest).
- **Sorts** (`docs/pagination.md`): `order=manual|updated|created|due|priority|key|cf:<fieldId>` with `dir`; nulls last both ways. A field sort reads the value rows in value order (a select by its options' order), then the items with no value; multi-select and person fields do not sort.
- **Columns.** The list's column gear (`useColumnsDropdown`, per page) offers created, updated, type and every live field beside the 2.3 six.
- **The board** groups by a select, multi-select (its first option), person or checkbox field; a drop into another lane of a select, person or checkbox field sets the value.
- **The detail** (page and sheet) shows the item's project's live fields with an editor per type (`CustomFieldInput`), through the versioned write.
- **The workspace-wide Work items page and My Work offer no custom fields**: fields are per project (ADR 0002, "What would change").

### Views in the UI

The views menu (`SavedViewsMenu`) on the Work items page and a project's page applies a view (filters, search, sort, layout, swimlanes, visible columns), saves the current state as a personal or shared view, updates or renames the applied one, and deletes it through the undo toast. The Views page (`/views`, which replaced 1.7's placeholder) lists every view the member can see, each opening its page with `?view=<id>`, which applies it. The field manager (`CustomFieldsManager`) opens from a project's page and from Settings → Projects for a viewer offered `manageCustomFields`.

## Cycles (2.5a)

Built by [`docs/porting/maps/2.5.md`](porting/maps/2.5.md) under owner decisions 62 to 75 (`docs/HANDOFF.md`) and ADR 0006 ("Cycle", "Cycle schedule", "Burn-up", "Transition"). Nothing was copied (`PROVENANCE.md`).

### The tables

| Table | Holds | Notes |
|---|---|---|
| `CycleSchedule` | A team's cycle settings: `enabled`, `lengthWeeks` (1–8), `firstStartsOn`, `upcomingCount` (1–6), `rollover` (`NEXT_CYCLE` or `NO_CYCLE`) | One row per team, made the first time someone saves them. `rollover` applies whether or not the schedule is enabled. |
| `Cycle` | A team's time box: `number`, optional `name`, `startsOn` and `endsOn` (date-only, inclusive), `fromSchedule`, `completedAt` | Cycles of a team never overlap: the exclusion constraint `Cycle_no_overlap` (btree_gist), and the same check in the usecases under the team's cycle lock (`cycle-team:<teamId>`), which answer 409 `CYCLE_OVERLAP`. Status is derived, never stored (`cycleStatus`): upcoming, current, ended (its last day passed, not yet closed), completed. |
| `WorkItemTransition` | One row per insert of a work item and per change of its state, cycle, project or deletion: the item's picture after the change | Written ONLY by the trigger `work_item_transition_record` (SECURITY DEFINER; `app_user` holds SELECT alone, so no request forges, changes or removes a row). No FK to `WorkItem`: rows outlive an item's purge and go with the workspace (decision 66). Read by the burn-up and, from 3.6, by analytics. |

`WorkItem.cycleId` references `Cycle(id, teamId, tenantId)`: an item can only be in a cycle of its own team. A move to another team's project clears it in the same `UPDATE` (`moveWorkItemToProject`). Deleting a cycle an item names is refused by the foreign key (RESTRICT); the delete usecase clears the items first. Migration `20261121120000_cycles_and_transitions`, with its catalogue test (`tests/integration/cycles-sql-constructs.test.ts`).

### Writes and who may make them

- **Keys** (decision 72, no new key): `cycles.view` reads cycles, their counts and the burn-up; `cycles.manage` creates, changes and deletes cycles and saves a team's cycle schedule (Members hold both; the team itself stays under `admin.manage`). Putting an item in a cycle is `work_items.edit`. The pages offer what `cycleAffordances` returns (`cycle.policies.ts`, the predicates the usecases assert), asked on the server.
- **One-off cycles** (decision 63): any dates that end today or later, at most 112 days, no overlap. A future cycle's dates may move; a started one keeps its start and its end may move, not before today; a completed one is read-only (409 `CYCLE_COMPLETED`). Only an upcoming cycle is deleted, and its items leave it first (each version increased, each audited). A schedule's cycle whose dates a person moved is no longer the schedule's.
- **The schedule** fills, on save and nightly, the window containing today and `upcomingCount` more (`planScheduledCycles`), skipping any window an existing cycle overlaps. Saving it again replaces the schedule's own upcoming cycles that hold no items, then refills.
- **An item's cycle:** `PUT /work-items/:id/cycle { cycleId }` (`null` takes it out), or `cycleId` on a create. A single-field change: `If-Match` optional, the version increases, a stale version is a 409 with the current row. Another team's cycle is a 400; a completed cycle a 409. Audited `WORK_ITEM_CYCLE_CHANGED` (from, to), shown in the item's Activity; watchers are told.
- **The list** filters by `cycleId` (ids, `none`, `current`; `docs/pagination.md`), shows a Cycle column (from the column gear), and the board groups lanes by cycle; a drop into another cycle's lane sets it.

### The rollover

`cycle-rollover` (`docs/jobs.md`), at 00:10 in `NOTIFICATIONS_TZ`, as the workspace system user (decision 64): for each team, it keeps the schedule filled, then closes every open cycle whose last day has passed, oldest first, and moves its unfinished items (Backlog, Unstarted, Started) to the team's next cycle, or out of cycles when the team's `rollover` is `NO_CYCLE` or no next cycle exists. Items in archived projects and deleted items stay in the closed cycle. A close is a conditional update, so a second or concurrent run closes and moves nothing. No bell and no mail; each moved item's Activity shows it.

### Counts and the burn-up

Counts (`GET /cycles`, `GET /cycles/:id`) and the burn-up (`GET /cycles/:id/burn-up`) read only items in projects the caller can see, live and unarchived, so a GUEST sees none until 8.4. The burn-up (`src/app-layer/domain/burn-up.ts`, decision 65) is one point per day from the first day to today (or the last day): scope (in the cycle, not deleted, not cancelled), started (Started or Done) and completed (Done), each at the end of the day in `NOTIFICATIONS_TZ` and "now" for today, from each item's latest transition. Items are counted, not points (estimates arrive in 3.4). Past 5,000 items it counts the first ones and says so.

### The pages

- **Cycles** (`/cycles`, a main page): each team's current cycle (scope, started, completed, a progress bar, days left), then its upcoming and completed cycles; for a viewer offered `manageCycles`, the team's cycle schedule, "New cycle", and delete on an upcoming cycle through the undo toast.
- **A cycle** (`/cycles/<id>`): the stats, the burn-up (`BurnUpChart`, the shared `@inflect/ui` time-series chart, with a table of the same points behind "Show as table"), and the cycle's items in the shared list and board (`WorkItemsView` scoped to the cycle; a new item there joins the cycle).
- **The detail** has a Cycle picker (the team's cycles that take items, and "No cycle").

## Settings (decision 55)

A workspace admin configures work without the API on the Settings pages (`src/app/t/[tenantSlug]/(app)/settings/`, components in `src/components/settings/`), built on 2.2's routes with no new route or usecase:

| Page | Reads | Offers |
|---|---|---|
| Settings (`/settings`) | teams, types, labels, projects (counts) | one card per section; while no open project exists, the first-project steps (a team, then a project, then work items), each step's state read from the server |
| Teams (`/settings/teams`) | `GET /teams` | create (the server seeds the workflow, and for a first team the types), rename, delete |
| A team's workflow (`/settings/teams/<id>`) | `GET /teams/<id>` | create a state with a category fixed from then on, rename, move up or down within its category, make default, archive and unarchive, delete moving its items to a state the person chooses |
| Work item types (`/settings/work-item-types`) | `GET /work-item-types?includeArchived=1` | create, rename, archive and unarchive |
| Labels (`/settings/labels`) | `GET /labels` | create for the workspace or one team, rename, delete |
| Projects (`/settings/projects`) | `GET /projects?includeArchived=1` | create (team, name, key prefix), rename, archive behind a typed confirmation (the key prefix), unarchive |

- **Who sees what.** Every page asks `mayOpenSettings` on the server (`settingsPageAccess`, `src/lib/server/settings-pages.server.ts`), the sidebar gear's rule; anybody else gets a 404. The writes each page offers are `workConfigAffordances` (`work-config.policies.ts`), built from the same predicates the usecases assert (`mayManageWorkConfig`, `mayCreateProject`, `mayEditProject`, `mayArchiveProject`), so an Admin whose custom role withholds `admin.manage` reads the configuration and is offered no change to it. No component restates decision 52.
- **Writes.** `apiSend` through `useSettingsApi` (`settings-data.ts`), then the list is read again; a refusal is shown as the server words it, in the dialog for a create or rename, as a toast otherwise. Deletes (a team, a state, a label) leave the list at once and are sent from inside the undo toast (`use-undo-delete.ts`, listed in `SITE_CONTRACTS`); a refusal that arrives when the window closes (a team with projects) puts the row back with the reason. Archiving a project is a typed confirmation, because its work items stop taking changes.
- **The workflow order.** `workflow-order.ts` lists a team's states by category in workflow order, and a move names the neighbour in the same category, so a state never leaves its category by being moved.
- **Not offered (decisions for this pull request).** Project delete and restore, a key-prefix change, type icons, colours and order, and label colours stay API-only. Settings stays admin-only through `mayOpenSettings`; a Member, who holds `projects.create`, creates a project from the Projects page instead (decision 57, "Views (2.3)"), through the same dialog.

