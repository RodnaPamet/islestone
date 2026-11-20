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

### Writes that touch several items (H2, decision 173)

Every write that changes more than one work item locks all of them first, in id order, in one statement (`SELECT … FOR UPDATE … ORDER BY "id"`, `WorkItemRepository.lockForWrite`), and only then reads the rows it plans from (owner decision 173, 2026-11-20; issue #65). Two overlapping writers then queue on the lowest shared id instead of each holding a row the other wants (a `40P01` deadlock), and what a write audits as the "from" value is the row as it was when the write changed it, not as an unlocked read saw it earlier. The writers: the four bulk verbs (state, assign, due date, delete, whose delete locks the whole subtree), a single delete's subtree, restore (the deletion group), a move to another project (the subtree), a member's removal (`lockItemsOfPerson`: assigned, waiting on, person values, pending reviewer rows, in one statement), a state's delete (`lockInState`), a cycle's or milestone's delete, the cycle rollover (per page, pages ascending), a label's delete (per batch, batches ascending), the review engine's withdraw-and-settle, the purge (`lockPurgeBatch`: the batch and the rows still pointing at it) and the sort-key rebalance (the project's rows, before the first rewrite).

The type system holds it: every repository method that can write more than one `WorkItem` row takes a `LockedWorkItemIds` (`src/app-layer/repositories/work-item-locks.ts`), which only the lock methods mint and `lockedSubset` narrows. `tests/guards/work-item-multi-row-lock.test.ts` refuses a `WorkItem` write in a function that neither takes the brand nor is a listed single-row writer (`updateVersioned`, `bumpVersionOf`, `setSortKey`), a cast to the brand outside its module, a single-row writer called in a loop or array callback, and a lock method that does not order by id `FOR UPDATE`. Where a write's set is a predicate (a member's items, a state's items) it locks by the predicate, then writes by the predicate, so a row a writer it waited on committed meanwhile is caught by the write's fresh snapshot.

**Lock order across kinds**, for every path that takes more than one: the workspace's graph lock (`lockWorkItemGraph`), then the projects' key-sequence rows (`ProjectRepository.lockSequences`, project-id order), then the work-item rows (id order). A board drop or a re-parent that also places the item now takes the sequence row before writing the item, as a reorder does; before, a drop that changed the state held the item and waited on the sequence a reorder of the same item held.

**Creates in one project** are serial by design (the gapless number is claimed under the sequence row lock, held to commit). `createWorkItem` waits its turn per project in the process before opening its transaction (`src/app-layer/usecases/project-create-queue.ts`, decision 174), so a waiting create holds no pooled connection: 25 simultaneous creates in one project succeed (`WORK_ITEM_CREATE_BURST_PER_PROJECT`), where 24 of 25 used to fail because the waiters held every connection the head of the queue needed for its audit append. The transaction budget is unchanged. Paths that create inside another usecase's transaction (intake accept, a project template's starter items, the repeat job) still wait on the row lock with their connection; they create one item, or a template's bounded set, at a time.

`tests/integration/concurrency/` proves it with the invariants read from the tables: key allocation under a 25-create burst with creates in another project and failing creates interleaved, 20 reorders into one gap and drops racing reorders of the same items, a bulk change racing a move of the subtree it touches, a bulk state change racing a writer that changes one of its items (the audit "from" against the recorded transition), overlapping bulk changes in opposite orders, a bulk change against a versioned edit, and a bulk assign against the member's removal. The deadlock, the stale "from", the FK refusal of the removal and the burst failed before the fix.

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

`WorkItem.description` and `Comment.body` are in the field-encryption manifest and sanitised with `sanitizePlainText` before they are stored; titles stay plaintext (ADR 0002 §11, search option S1) and, since 2.7b, are indexed for search ([`docs/search.md`](search.md)); descriptions and comments are searched from 2.7f (ADR 0008). Adding `Comment.body` exposed a defect in the encryption extension, fixed here: it fanned out by field name at the top level of a write to any model outside the manifest, which sealed `Notification.body` and `TenantCustomRole.description` under the workspace key, outside the rotation sweeps.

## Views (2.3)

Built by [`docs/porting/maps/2.3.md`](porting/maps/2.3.md). The pages are Work items (`/work-items`, every visible item), a project (`/projects/<prefix>`), Projects, each as a list or a board, My Work (below), and an item's page (`/work-items/<key>`; an old key or an id redirects to the current key).

- **Projects** (`src/app/t/[tenantSlug]/(app)/projects/page.tsx`, `src/components/work-items/ProjectsList.tsx`) lists every visible project with its key prefix, team and status, each linking to its work items. Anyone who holds `projects.create` creates a project there, outside Settings (owner decision 57): the server page asks `mayCreateProject(ctx)`, the predicate `createProject` asserts, and hands the list a boolean; the header's Project button opens `ProjectCreateDialog` (`src/components/settings/`), the one dialog Settings → Projects opens too (a team, the first by default, also when the teams arrive after it opened; a name; a key prefix), which posts to `POST /projects`. The new project shows at once and the page's server list is read again (`router.refresh()`). With no team, the dialog says a project needs one and links to Settings → Teams only for a viewer who may open Settings (`useMayOpenSettings`); anyone else is asked to ask an admin.

- **One query, one cache.** The list, every board column and the sub-items read `useWorkItemList` (cursor pages of `GET /work-items` in SWR); the detail, page and sheet alike, reads `useWorkItem` and its sub-resources. A write goes through `useWorkItemMutations` or `useWorkItemCollab`, which put the changed row in every loaded list (`work-item-cache.ts`: out of a list it no longer matches, into one it now matches at its order, in place where the client cannot tell) and then take the server's row, so the server's `sortKey` and `version` win. A list whose first read has not answered yet holds the change and applies it to that answer, never to the empty cache: SWR discards a read a mutation overlaps, so writing at once left a column that was still loading empty for good, and a card dropped into it in no column (issue #41).
- **Writes.** Optimistic, versioned (`If-Match` on every write to the item, its state, assignee and move), serialised per item. A 409 `VERSION_CONFLICT` is retried once with the current version when none of the fields the write changes moved; otherwise every view shows the server's row and the person is told the item changed. Any other refusal puts the previous row back and shows the server's reason. A description edit is never retried (the conflict answer carries no description). Deletes and removals (an item, a comment, a watcher, a label, a relation, a link, a bulk delete) leave the view at once and are sent when the undo toast's window closes.
- **Filters.** The shared filter system, synced to the URL; every option comes from the server page's configuration (`getWorkItemViewConfig`: visible projects, teams, live states, types, labels, and on a project's page its custom fields) or the roster (`GET /users/assignable`), never from the rows a page loaded. Order is manual (`sortKey`) by default; 2.4 adds the other sorts (below). The search box sends `q`: a title substring (served by `WorkItem_search_title_trgm` since 2.7b; `%` and `_` match themselves) or an exact key ([`docs/search.md`](search.md)).
- **The board.** A project's columns are its team's states, grouped by category; a board over several teams has one column per category, and a drop takes the item to its own team's default state of that category. Lanes group by assignee, priority, type, label or project; a drop into another assignee, priority or type lane changes that field, while label and project lanes are fixed. A drop is `POST …/move { stateId, position }`: the state change and the place beside the neighbour in one transaction (`moveWorkItemOnBoard`), with the state change's audit entry and effects. A long column is virtualised; the cell is the drop target for cards that are not mounted. Keyboard: Space picks a card up, the arrows move it (down past a cell's end enters the next lane when lanes are movable), Space or Enter drops, Escape cancels, and each step is announced in a live region; every card also has a "Move to…" menu.
- **Comments** offer edit and delete from `comment.policies.ts` itself (decision 53), so the page offers exactly what the server allows.
- **My Work** (decision 54; `src/app/t/[tenantSlug]/(app)/my-work/page.tsx`, `src/components/work-items/MyWorkView.tsx`) is five sections, each a `useWorkItemList` read of `GET /work-items` under one filter toolbar: **Assigned to me** (`assigneeId=<me>`), **Waiting on me** (`waitingOnId=me`, 2.7a, decision 76: the server reads the caller from the request context, as for `watching=me`; open items only, by the 2.4b CHECK), **Created by me** (`createdById=<me>`), **Watching** (`watching=me`, the caller read from the request context on the server; no other value is accepted) and **Due soon** (`assigneeId=<me>&due=soon`: open items overdue or due within `DUE_SOON_DAYS`, 7, counted in whole days from today in `NOTIFICATIONS_TZ`). "Me" is the page's server context user; an item may sit in several sections. Each section shows the count of its loaded rows ("N+" while more pages exist), an empty state and an explicit "Load more" (25 rows a page; stacked sections under load-on-scroll would keep pushing the next one away). Closed categories (DONE, CANCELLED) are hidden unless the category filter names some: a default of My Work only, the Work items and project pages show every category. The sections are lists, in manual order (2.4's sorts are offered on the Work items and project pages, not in My Work's sections); the board stays on the Work items and project pages. The list row carries `createdByUserId`, so a create lands in "Created by me" at once; the watcher set is not on the row, so the caller's own watch or unwatch re-reads the lists filtered by `watching`; the client cannot resolve `me`, so a waiting-on change re-reads the lists filtered by `waitingOnId=me` (`waitsOnMe`). No index was added: `[tenantId, createdByUserId, createdAt]`, `WorkItemWatcher [tenantId, userId]` and `[tenantId, assigneeId, stateCategory, dueDate]` serve the three filters; `[tenantId, waitingOnUserId, stateCategory, dueDate]` (2.4b) serves the fourth.

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

## Milestones (2.5b)

Built by [`docs/porting/maps/2.5.md`](porting/maps/2.5.md) under owner decisions 62 and 72 (`docs/HANDOFF.md`) and ADR 0006 ("Milestone"; its date is the due date, because the ADR bans "Target"). Nothing was copied (`PROVENANCE.md`).

### The table

| Table | Holds | Notes |
|---|---|---|
| `Milestone` | A project's dated group: `name` (unique in the project, plaintext, sanitised, at most 100 characters), optional `dueDate` (date-only), `sortKey` (the project's milestone order, a fractional index, `COLLATE "C"`) | Belongs to one project and goes with it (cascade). No stored status: progress and "late" are derived. |

`WorkItem.milestoneId` references `Milestone(id, projectId, tenantId)`: an item can only be aimed at a milestone of its own project. A move to another project clears it in the same `UPDATE` (`moveWorkItemToProject`). The foreign key is `NO ACTION`: deleting a milestone an item still names is refused, so the delete usecase clears the items first, while a workspace's or project's cascading delete, which removes items and milestones in one statement, passes. The transition trigger now also records a change of milestone (`WorkItemTransition.milestoneId`), for 3.6's analytics. Migration `20261122120000_milestones`, with its catalogue test (`tests/integration/milestones.test.ts`).

### Writes and who may make them

- **Keys** (decision 72, no new key): `projects.view` reads a project's milestones and their progress; `projects.edit` creates, renames, re-dates, reorders and deletes them (Members hold it). Aiming an item at a milestone is `work_items.edit`. The pages offer what `milestoneAffordances` returns (`milestone.policies.ts`, the predicates the usecases assert), asked on the server. An archived project's milestones are read-only (409 `PROJECT_ARCHIVED`).
- **Milestones:** `GET`/`POST /projects/:projectId/milestones`, `PATCH`/`DELETE /projects/:projectId/milestones/:milestoneId`. A new one is appended to the project's order; `PATCH` takes `name`, `dueDate` (`null` clears it) and `position { afterId | beforeId }`, computed under the project's row lock. A name taken in the project is a 409 `MILESTONE_NAME_TAKEN`. Deleting one takes it off every item that names it (deleted items too; each version increased, each audited `WORK_ITEM_MILESTONE_CHANGED`), then deletes it. Each write is audited (`MILESTONE_CREATED`, `MILESTONE_UPDATED`, `MILESTONE_DELETED`).
- **An item's milestone:** `PUT /work-items/:id/milestone { milestoneId }` (`null` clears it), or `milestoneId` on a create. A single-field change: `If-Match` optional, the version increases, a stale version is a 409 with the current row. Another project's milestone is a 400. Audited `WORK_ITEM_MILESTONE_CHANGED` (from, to), shown in the item's Activity; watchers are told.
- **The cycle rollover never touches milestones.**

### Progress

Progress (`listMilestones`, `getMilestone`) counts live items in projects the caller can see (an archived project's included, so its milestones keep their numbers): scope is every such item not cancelled, done the ones in a Done state. A milestone is **late** when its due date is before today (in `NOTIFICATIONS_TZ`) and open items remain; one whose items are all done shows as complete.

### The pages and the views

- **A project's milestones** (`/projects/<prefix>/milestones`, a subpage of the project, linked from its header): each milestone in order with its due date, a "late" or "complete" mark and a progress bar (done of scope); for a viewer offered `manageMilestones`, "Milestone" (create), and per row Move up, Move down, Edit (name and due date) and Delete through the undo toast.
- **A milestone** (`/projects/<prefix>/milestones/<id>`): its due date, scope, done and percentage, and its items in the shared list and board (`WorkItemsView` scoped to the project and the milestone; a new item there is aimed at it).
- **Items:** the detail and the create dialog have a Milestone picker (the project's milestones, and "No milestone"); the list a Milestone column (from the column gear) and a Milestone filter (`milestoneId`: ids and `none`, `docs/pagination.md`; on the Work items page the options name each milestone's project); the board groups lanes by milestone, and a drop into another milestone's lane sets it on a board of one project (on a board of several, milestone lanes take no drops, since a milestone is one project's).
- Saved views store the milestone filter and lanes, as they store the cycle ones (both were refused by the saved-view schema before 2.5b; `BUILT_IN_LANES` in `src/lib/work-items/list-sorts.ts` is now the one list the board and the schema read).

## Templates (2.5c)

Built by [`docs/porting/maps/2.5.md`](porting/maps/2.5.md) under owner decisions 71 to 73 (`docs/HANDOFF.md`) and ADR 0006 ("Template"). Nothing was copied; inflect-compliance's "one projection from template to task" was read for the pattern (`PROVENANCE.md`).

### The tables

| Table | Holds | Notes |
|---|---|---|
| `WorkItemTemplate` | A project's item template: `name` (unique in the project), and what a new item starts from: `title`, `description` (ENCRYPTED), `typeId`, `priority`, `assigneeId`, `dueInDays` (0 to 3650, a CHECK), `customFieldValuesJson` (as `customFields` on a create), `subItemsJson` (`[{ title }]`), `sortKey`, `archivedAt` | Goes with its project. The type is a composite FK (RESTRICT; types are archived, never deleted); the assignee has no FK and is checked at save and at use; removing a member clears it (`removeTenantMember`). |
| `WorkItemTemplateLabel` | The labels a template puts on its items | Goes with the template or the label (both cascade), so a deleted label leaves every template. |
| `ProjectTemplate` | A workspace's project template: `name` (unique in the workspace), `contentJson` (ENCRYPTED: the whole content, one document), `contentVersion`, `sortKey`, `archivedAt` | The content is `ProjectTemplateContentSchema` version 1 (`src/lib/schemas/template.ts`): custom fields with options, milestones with `dueInDays`, item templates, and starter items with sub-items, labels and types by name, a milestone by index; at most 50 fields, 50 milestones, 50 item templates, 200 starter items, 50 sub-items each and 256 KB. |

Migration `20261123120000_templates` (`COLLATE "C"` on both `sortKey`s, the CHECK, the grants and the RLS policies), with its tests (`tests/integration/templates.test.ts`).

### Writes and who may make them

- **Keys** (decisions 71 and 72, no new key): item templates are read under `projects.view` and managed under `projects.edit` (Members can); project templates are saved, renamed, archived and deleted under `admin.manage`, and listed and used under `projects.create`. The pages offer what `templateAffordances` returns (`template.policies.ts`), asked on the server. An archived project's item templates are read-only.
- **Item templates:** `GET`/`POST /projects/:projectId/work-item-templates`, `PATCH`/`DELETE /projects/:projectId/work-item-templates/:templateId` (`PATCH` also archives, unarchives and reorders by neighbour). Everything is checked against the project at save: a live type, labels the project's items may carry, an active member, live fields and options. A name taken in the project is a 409 `TEMPLATE_NAME_TAKEN`. Audited `ITEM_TEMPLATE_CREATED`, `_UPDATED` (field names only), `_ARCHIVED`, `_RESTORED`, `_DELETED`.
- **A work item from a template:** `POST /work-items` with `templateId` (title and type may then be left out). The ONE projection, `templateToCreateInput` (`src/app-layer/domain/work-item-template.ts`, pure and unit-tested), fills the create: every field the request names wins; the due date is `dueInDays` from today (`NOTIFICATIONS_TZ`); what no longer fits (a label the item cannot carry, an assignee who is no longer an active member, an archived field or option) is skipped and named in the response's `templateSkipped`. An archived template is a 409 `TEMPLATE_ARCHIVED`; a template whose type has been archived is a 409 `TEMPLATE_TYPE_ARCHIVED` unless the request names a type. The template's sub-items are made in the same transaction, in its order (the team's default state, the item's type and milestone). The item's and each sub-item's `WORK_ITEM_CREATED` entry records `templateId`.
- **Project templates:** `GET /project-templates` lists names (with counts of what each holds for an admin, never the content); `POST /project-templates { fromProjectId, name, includeItems }` saves a project as a template: its live fields and options, its milestones (due dates as days from today), its live item templates and, with `includeItems`, its open top-level items with their open sub-items. People are not kept. `PATCH`/`DELETE /project-templates/:id` renames, archives and deletes. The content is not edited in the browser (decision 71): save a project again. Audited `PROJECT_TEMPLATE_CREATED`, `_UPDATED`, `_ARCHIVED`, `_RESTORED`, `_DELETED`.
- **A project from a template:** `POST /projects` with `templateId`. `createProject` applies it in its own transaction (`applyProjectTemplateInTx`), so a failure part-way leaves no project: the fields and options, the milestones (dates counted from today), the item templates, and the starter items with their sub-items (through `templateToCreateInput`). It creates no team and no workflow; types and labels are matched by name (a team's label before a workspace label of that name), and a name that matches nothing is reported in the response's `fromTemplate.skipped` and the `PROJECT_CREATED` entry, never created and never silently dropped (an unknown type falls back to the workspace's first type and is named). A template whose content no longer parses is a 409 `TEMPLATE_CONTENT_INVALID`.

### The pages

- **Create dialog:** a Template picker (the project's live item templates) above the title. Choosing one fills the form; the dialog then sends the template and only what the person changed, so the server applies the rest (sub-items and field values included) and skips what no longer fits.
- **A project's page:** a Templates button (for a viewer offered `manageItemTemplates`, on a live project) opens the item-templates manager: create and edit (name, the item's title, description, type, priority, assignee, labels, due in days, sub-items one per line), archive, unarchive, and delete through the undo toast. Custom-field values are set through the API.
- **Project create dialog** (the one dialog, decision 57): a Template picker of the workspace's live project templates; what the chosen template named and the workspace lacks is shown after the create.
- **Settings → Projects:** "Save as template" per project (name, and whether to include open items), for a viewer offered `manageProjectTemplates`. **Settings → Project templates** (`/settings/project-templates`): what each holds, rename, archive, unarchive and delete (undo toast).

## Repeats (2.5d)

Built by [`docs/porting/maps/2.5.md`](porting/maps/2.5.md) under owner decisions 67 to 70 and 72 (`docs/HANDOFF.md`) and ADR 0006 ("Repeat"). Nothing was copied; inflect-compliance's cadence and scheduler and Kaneo's recurrence were read for patterns (`PROVENANCE.md`).

### The table

| Table | Holds | Notes |
|---|---|---|
| `WorkItemRecurrence` | The repeat on one item (`sourceWorkItemId`, one per item): `frequency` (daily, weekly, monthly, yearly), `interval` (1 to 99), `weekdays` (weekly only, 0 Sunday to 6 Saturday), `firstOn` (the item's due date when the repeat was set), `endsOn` or `maxOccurrences` (the item itself counted, 2 to 1000), `leadDays` (0 to 30, default 3), `nextOccurrenceOn` (stamped), `occurrenceCount`, `ownerUserId`, `heldAt` and `heldReason` | Goes with its item (cascade). CHECKs hold the ranges, the weekly-only weekdays, the end after the first date and a hold with its reason. "On hold", not "paused", in the schema: ADR 0006 keeps "Pause" for the kill switch, so the enum is `RecurrenceHold`. |

`WorkItem.recurrenceId` and `occurrenceOn` mark a copy: one item per `(recurrenceId, occurrenceOn)` (a partial unique), and the link is `ON DELETE SET NULL ("recurrenceId")`, so stopping a repeat leaves its copies in place. Migration `20261126120000_repeats`, with its tests (`tests/integration/repeats.test.ts`).

### The rule

`src/app-layer/domain/recurrence.ts` (pure, property-tested) is the one home of the stepping. Occurrence 1 is `firstOn`, the item itself; later dates are every N days, every N weeks on the chosen weekdays (weeks from Monday; none chosen means the due date's weekday), or every N months or years on `firstOn`'s day of the month, clamped to a short month's last day and computed from `firstOn` each time (a series on 31 January lands on 28 or 29 February, then 31 March; 29 February lands on the 28th in common years). No time zone: due dates are date-only. A new or resumed repeat waits for the first occurrence at least its lead days away, so the job makes one occurrence a night per rule with nothing counted as missed.

### Writes and who may make them

- **Keys** (decision 72): `GET /work-items/:id/recurrence` (`work_items.view`) returns the repeat on the item and the series it is a copy in; `PUT` (`work_items.create`; the usecase also asserts `work_items.edit`) sets, changes, puts on hold (`onHold: true`) or resumes a repeat; `DELETE` (`work_items.edit`) stops it. The item needs a due date (409 `RECURRENCE_NEEDS_DUE_DATE`). Setting or resuming makes the caller the owner (decision 70); a hold keeps the owner. A request never makes an occurrence. Audited `RECURRENCE_SET`, `_UPDATED`, `_HELD`, `_RESUMED`, `_REMOVED`, and the job's `_HELD` and `_ENDED`.
- **The job** is `work-item-recurrence` (`docs/jobs.md`), 00:30 in `NOTIFICATIONS_TZ`: as the owner, re-resolved before each copy, it claims the stamped date and makes the latest due occurrence through `createWorkItemInTx` (the create path's in-transaction core, with its options `recurrenceId`, `occurrenceOn` and `subItems`; `emitCreatedItemBells` rings its bells after the commit). The copy takes, from the item as it is then: title, description, type, priority, labels the item may still carry, the assignee if still an active member, custom-field values still valid, the milestone and the live sub-items; its due date is the occurrence, a start date keeps its distance from the due date, and it starts in the team's default state. Not taken: comments, watchers, relations, links, cycle. It goes through `templateToCreateInput`, the one projection 2.5c built, and what it skipped is named in its `WORK_ITEM_CREATED` entry with `recurrenceId` and `occurrenceOn`. An occurrence already made (before a hold) is not made again.
- **Holds** (decision 70): the owner no longer an active member (`OWNER_NOT_ACTIVE`), without `work_items.create` or without sight of the project (`OWNER_NOT_PERMITTED`), the item deleted (`SOURCE_DELETED`), the project archived (`PROJECT_ARCHIVED`), the end reached (`ENDED`), or a person's hold (`HELD_BY_MEMBER`). The job writes a hold as the workspace system user, naming the owner; a copy is never made as the system user. Anyone allowed may resume a repeat and becomes its owner.

### The views

- **The detail** has a Repeat row (`RepeatControl`): what the repeat does, its next date or why it is on hold, and for a viewer who may create and edit work items Set repeat or Edit repeat (a dialog: frequency, every N, weekdays, end date or number of times, lead days), Put on hold, Resume, and Stop repeat through the undo toast. A copy says which item's series it is in and links to it.
- **The list** marks an item that repeats ("Repeats") and a copy in a series ("In a series") beside its title.

## Waiting on (2.4b-a)

Built by [`docs/porting/maps/2.4b.md`](porting/maps/2.4b.md) under owner decisions 100 and 103 to 107 (`docs/HANDOFF.md`), ADR 0002 §14 and ADR 0006 ("Waiting on"). Nothing was copied (`PROVENANCE.md`).

### The column

`WorkItem.waitingOnUserId` names the one active member who must act next on an item, apart from its assignee. It never makes anyone accountable: the assignee stays the one accountable person (ADR 0003 §1), and nothing routes delegation or proposals by it; due reminders go to the person it names from 2.7a (decision 137). It references `TenantMembership(tenantId, userId)`, `ON DELETE RESTRICT` like the assignee: removing a member clears it first (`removeTenantMember`, every item's version increased, one `WORK_ITEMS_WAITING_ON_CLEARED_ON_MEMBER_REMOVAL` entry), and a deactivated member stays named. A closed item waits on nobody: every move into a Done or Cancelled state clears it through `stateTransitionEffects` (the single state change, the bulk one, a board drop, marking a duplicate, a state's delete that moves its items, the create), a reopen does not restore it, and the CHECK `WorkItem_waiting_on_open_only` refuses any path that forgets. The transition trigger records each change (`WorkItemTransition.waitingOnUserId`), so 3.6 can count time waiting from recorded changes. Index `[tenantId, waitingOnUserId, stateCategory, dueDate]`. Migrations `20261128120000_notification_type_waiting_on` (the bell's enum value, alone) and `20261128120100_waiting_on`, with the catalogue and behaviour tests in `tests/integration/waiting-on.test.ts`.

From 6.3 it may name the delegate's agent session instead of a member (decision 106): 6.3 adds a nullable session reference beside `waitingOnUserId`, with a CHECK that at most one of the two is set, and widens the closed-item CHECK to both. Nothing stored now is rewritten for it.

### Writes and who may make them

- `PUT /work-items/:id/waiting-on { userId }` (`null` clears it), or `waitingOnUserId` on a create; key `work_items.edit` (decision 104), as an item's cycle and milestone. A single-field change: `If-Match` optional, the version increases, a stale version is a 409 with the current row. Anyone who is an active member may be named (the assignee's rule, Viewers included; decision 103); another person is a 400; a closed item (or a create into a closed state) is a 409 `ITEM_CLOSED`. Audited `WORK_ITEM_WAITING_ON_CHANGED` (from, to), shown in the item's Activity; watchers are told.
- **The bell** (decision 105): the person named gets one in-app notification, `WORK_ITEM_WAITING_ON` (`createAssignmentNotification` through `emitWaitingOnBell` in `work-item-shared.ts`, after the commit), unless they named themselves; a workspace may mute it like the other bell types. No email and no reminder until 2.7.
- **Who else sets it** (decision 106): a repeat copy takes its source's, while that person is an active member (otherwise none, named in the copy's `skipped`); 2.8's review steps will set it. Templates and intake accept do not.

### The views

- **The detail** has a Waiting on row (`WaitingOnPicker`: the member roster and "Nobody"); on a closed item it says that a closed item waits on nobody. **The create dialog** has the same picker while the chosen state is open.
- **The list** has a Waiting on column (from the column gear) and a Waiting on filter (`waitingOnId`: member ids and `none`, `docs/pagination.md`); **the board** groups lanes by waiting on, and a drop into another person's lane names them (not into a closed column, which clears it). Saved views store both (`WORK_ITEM_FILTER_KEYS`, the saved-view `FilterKey`, `BUILT_IN_LANES`).
- My Work's "Waiting on me" section (2.7a, decision 76) reads this filter as `waitingOnId=me`; `me` is resolved to the caller on the server, beside ids and `none`.
- **Due reminders** (2.7a, decision 137) go to the person an item waits on as well as its assignee: the same windows and `WORK_ITEM_DUE` type, worded "waiting on you", unassigned items included, one reminder when the assignee is the person waited on (`dueRecipients` in `src/app-layer/notifications/work-item-due.ts`); naming who an item waits on rings today's window for them (`docs/notifications.md`).

## Field sets (2.4b-b)

Built by [`docs/porting/maps/2.4b.md`](porting/maps/2.4b.md) under owner decisions 101 and 108 to 112 (`docs/HANDOFF.md`), ADR 0002 §1 and §7 and ADR 0006 ("Field set"). Nothing was copied (`PROVENANCE.md`).

### The rules

A work item type's field set says, for each configurable field, whether it is **Required**, **Optional** or **Hidden**. The configurable built-in fields are description, assignee, waiting on, priority (required means not None), labels (at least one), start date, due date, cycle, milestone and the answer (decision 110); title, type, project and state are always required. The answer (2.4b-c) is Hidden without a rule and is only ever Shown (Optional) or Hidden.

- **Where a rule lives** (decision 108): a built-in field's rule belongs to the type across the workspace; a custom field's belongs to the type within the field's project. A rule for an archived custom field is ignored.
- **No row means Optional** (the answer: Hidden), so nothing was backfilled and every workspace behaves as before until someone sets a rule.
- **One evaluation.** `src/lib/work-items/field-sets.ts` (client-safe, property-tested) resolves a type's set for a project (`resolveFieldSet`), says when a field is empty (`isFieldEmpty`), finds the required fields left empty (`fieldSetGaps`) and the hidden fields a write gives a value (`hiddenFieldsSet`). The usecases (`src/app-layer/usecases/field-set.ts`), the server pages and every form call these functions with the server's rows; a component never restates a rule.

### The table

`WorkItemTypeField` (`prisma/schema/work.prisma`): `typeId`, `projectId` (NULL for a built-in rule), exactly one of `builtInField` (text, CHECKed against the configurable list, so 2.8 and 3.4 add a field without an enum migration) and `customFieldId`, and `requirement` (`FieldRequirement`). Foreign keys cascade from the type, the project and the custom field (the last through `CustomField(id, projectId, tenantId)`, so a rule can never name another project's field); two partial uniques keep one rule per type and field; a CHECK refuses a required answer. Row-level security, its own grant and a two-tenant test as every tenant table. Migrations `20261130120000_recurrence_hold_field_set` (the new hold reason, alone) and `20261130120100_field_sets`; the catalogue and behaviour tests are `tests/integration/field-sets.test.ts`.

### Who sets them

- `GET/PUT /work-item-types/:typeId/fields { field, requirement }`: built-in rules, read under `projects.view`, set under `admin.manage` (decision 112, as types). Setting a field to its default removes the row.
- `GET/PUT /projects/:projectId/type-fields { typeId, customFieldId, requirement }`: a project's custom-field rules for every type, read under `projects.view`, set under `projects.edit` (as field definitions). The field must be the project's and live.
- Each change is audited `WORK_ITEM_TYPE_FIELD_SET` (the type, the field and the new requirement; not shown in an item's Activity). A refused write is validation, not authority: a 400, never an `AUTHZ_DENIED`.
- A project template carries the project's Required and Hidden custom-field rules by type and field name; a project made from it creates the rules whose type and field it finds and names the misses (`fieldRule:<type>/<field>`) in `fromTemplate.skipped`. Built-in rules belong to the workspace and are not carried.

### What is enforced, for every caller

Decision 111: one rule for the forms, the API and the jobs.

- **A create** (the dialog, the API, a template's sub-items, a project template's starter items, an intake accept, a repeat copy) is checked over the whole item after the template's projection: a required field left empty is a 400 `FIELD_SET_UNMET` naming the fields (`details.fields`), and a hidden field the request names with a value is a 400 `FIELD_HIDDEN`. A hidden value that a template or a projection brought is skipped and named (`hidden:<field>` in `templateSkipped`, and `fieldSetSkipped` on `WORK_ITEM_CREATED`). A create into a closed state is never refused for a gap.
- **A change** to an open item (the versioned update, assign, waiting on, cycle, milestone, a custom-field value, adding or removing a label, bulk assign and bulk due date) is refused when it empties a required field or gives a hidden one a value; a bulk write refuses the whole batch and names the item. **A type change** is checked against the new type's whole set (decision 109).
- **Existing items are not rewritten** (decision 109): any other write to an item that breaks its type's rules passes, and the detail lists the missing fields. A closed item (Done or Cancelled) is never refused for a gap, so closing a question, which clears its waiting on, always works. System clears (deleting a cycle, milestone or label, removing a member, the rollover to no cycle) are not refused either: they leave a gap the detail shows.
- **A repeat copy** that a field set refuses puts its repeat on hold with the reason `FIELD_SET_UNMET`, shown on the detail's Repeat row; it is not retried each night.
- **Intake accept** takes due date, start date, milestone and waiting on as well, so a type that requires them can still be accepted; its dialog offers them when the type requires them.

### The views

- **Settings → Work item types → a type** (`settings/work-item-types/[typeId]`, `WorkItemTypeFieldsSettings`): each built-in field with Required, Optional or Hidden (the answer: Shown or Hidden), changeable only with `manageWorkConfig`.
- **A project's field manager** (project page and Settings → Projects): "Per type" on each live field, a requirement per type, offered with `manageCustomFields`.
- **The create dialog** does not offer hidden fields, marks required ones, offers a start date and the required custom fields, and names the gaps before sending; **the detail** leaves hidden fields out (unless they hold a value), marks required ones and lists what an open item is missing; **the intake accept dialog** and **the item-templates manager** leave out what the type hides. The rules come from the view configuration (`fieldSetEntries`, built-in rules) and `GET /projects/:id/type-fields` (`useFieldSet`). The sub-item quick add opens the full create dialog.
- List columns, filters and lanes are unchanged: they span types.

## Questions (2.4b-c)

Built by [`docs/porting/maps/2.4b.md`](porting/maps/2.4b.md) under owner decisions 102 and 113 to 118 (`docs/HANDOFF.md`), ADR 0002 §15 and ADR 0006 ("Answer"). Nothing was copied (`PROVENANCE.md`).

### The answer

`WorkItem.answerCommentId` points at one live comment of the same item, its marked answer. The composite foreign key `(answerCommentId, id, tenantId)` → `Comment(id, workItemId, tenantId)` (Comment's new unique key) makes another item's comment unstorable; it is `NO ACTION`, so the purge's cascade from an item to its comments passes. Comments are soft-deleted, so the foreign key cannot see a delete: the usecases refuse it, and the trigger `comment_answer_not_deleted` (`BEFORE UPDATE OF "deletedAt"` on `Comment`) refuses setting `deletedAt` on a comment an item marks, for any writer; it leaves the key-rotation sweeps' re-wrap of the text alone. Index `[tenantId, answerCommentId]`. Migration `20261202120000_answers`; the behaviour and catalogue tests are `tests/integration/questions.test.ts`.

**There is no Question type in code** (decision 118). The answer is a field-set field: Hidden unless the type's field set shows it, never Required. Any type whose field set shows the answer is question-like; nothing keys on a type's name or identity.

### Writes and who may make them

- `PUT /work-items/:id/answer { commentId, stateId? }` marks a comment; `DELETE /work-items/:id/answer` clears it. Key `work_items.edit`; a person only (`assertActingAsPerson`: an API key or an agent is a 403 `NOT_A_PERSON`, never proposed); the field set must show the answer (otherwise 400 `FIELD_HIDDEN`); the comment must be a live comment of the item (404). A single-field change: `If-Match` optional, the version increases, a stale version is a 409 with the current row.
- **Marking moves an open item to Done** (decision 114) in the same versioned write, through `stateTransitionEffects` (so waiting on is cleared and the transition trigger records the move): to the Done state the request names (`stateId`, which must be a live Done state of the item's team: 400 `NOT_A_DONE_STATE`), or else the team's first live Done state in its order (a team with none: 409 `NO_DONE_STATE`). The plan is the pure `planAnswerMark` (`src/app-layer/domain/work-item-answer.ts`).
- **On a closed item** (Done or Cancelled), marking and clearing change only the answer; clearing never reopens (decision 115).
- **The marked comment is locked** (decision 113; `comment.policies.ts`: `isMarkedAnswer`, `commentAffordances`): while it is the answer, neither its author edits it nor anyone deletes it, an admin included: 409 `ANSWER_LOCKED`, "clear the answer first". An admin moderates in two steps: clear the answer, then delete the comment (`COMMENT_MODERATED`).
- Audited `WORK_ITEM_ANSWER_MARKED` / `WORK_ITEM_ANSWER_CLEARED` (`changedFields: ['answerCommentId']`, the comment's id, never its text) inside the transaction, then the state change's own `WORK_ITEM_STATE_CHANGED`; after the commit, the state change's automation and watcher fan-out, then the watchers are told the item was answered (`emitWatcherActivity`, kind `answered`).
- **The asker hears** (decision 117): the creator of an item whose type shows the answer becomes a watcher in the create's transaction (`creatorWatching` on `WORK_ITEM_CREATED`), on every create path (the dialog, the API, template sub-items, starter items, intake accept, repeat copies), never the workspace system user. Other types' creates add no watcher.
- Templates and repeats never copy the answer (comments are not copied).

### Setting it up (decision 116)

Nothing is seeded: Feature, Bug and Chore stay the only seeded types.

- **Settings → Work item types → "Add the Question type"** (`POST /work-item-types/question-preset { name? }`, `admin.manage`, `addQuestionType`): one transaction makes a type, named Question unless the admin gives another name (a taken name is a 409 `TYPE_NAME_TAKEN`), with its field set: due date and waiting on Required, the answer shown. Audited `WORK_ITEM_TYPE_CREATED` and one `WORK_ITEM_TYPE_FIELD_SET` per rule. The type is ordinary afterwards: renamed, archived or re-ruled like any other. The preset's values are `src/lib/work-items/question-preset.ts` (client-safe).
- **A project's item-templates manager → "Add a Question template"**, offered when some type shows the answer: fills the form with the preset (name and title Question, the first such type, due in 5 days) for the person to review and save through 2.5c's ordinary template route (`projects.edit`). A Question requires waiting on, which templates do not carry, so the create dialog asks for it.

### The views

- **The detail**: on each comment, "Mark as answer" where `commentAffordances` allows (someone who may edit the item, the field set showing the answer, not already the answer); when the team has several live Done states and the item is open, a dialog asks which one, the first preselected. The marked comment carries "Answer" and says it is locked; the answer is pinned on the Overview with its author and "Clear answer", which goes through the undo toast.
- **Activity** shows "marked an answer" and "cleared the answer".
- No list filter or column in 2.4b.

## Mentions (2.7d)

Built by [`docs/porting/maps/2.7.md`](porting/maps/2.7.md), part 5, under owner decisions 127 to 131 (`docs/HANDOFF.md`) and ADR 0006 ("Mention"). Written fresh; nothing was copied (inflect-compliance has no mention feature).

### The text and the rows

Comments and descriptions stay plain text (decision 127): a mention is the token `<@userId>`, which the `@` picker puts in the text; `sanitizePlainText` keeps it as typed. The grammar is the pure, property-tested `src/app-layer/domain/mention.ts` (client-safe): `parseMentionIds` (each person once, in order, at most `MAX_MENTIONS_PER_TEXT`, 20; a prefixed `<@agent:…>` is refused until 6.3), `planMentionChange`, `segmentText` (for display), and the picker's `mentionQueryAt` / `insertMention`.

**The `Mention` rows are the authority, not the text.** `Mention` (`tenantId`, `workItemId`, `commentId`, NULL for the description, `mentionedUserId`, `mentionedById`, an actor stamp with no FK, `createdAt`): one row per source and person (two partial uniques), cascading with the item, the comment and the membership (a removed member's mentions go and render as text). Index `[tenantId, mentionedUserId, createdAt]`; RLS, grants, and the two-tenant test `tests/integration/mentions.test.ts`. Migrations `20261205120000_notification_type_mentioned`, `20261205120100_email_type_mentioned` (each enum value alone) and `20261205120200_mentions`. A token renders as a chip only when its source has a row for that person, so a token an intake requester typed, a template or a repeat copied, or somebody pasted names nobody and notifies nobody.

### Writes

- **Who records** (decision 129). `recordMentionsInTx` (`src/app-layer/usecases/mention.ts`) runs in the transaction of a person's own write, on the sanitised text: `addComment` and `editComment`, `updateWorkItem` when the description changes, and `createWorkItem` when the request itself names the description. Intake accept, a template's projected description, template sub-items and repeat copies call the create core without asking for mentions and record none; an API key (5.2), an agent and the workspace system user record nothing (`writesAsPerson`). A person's later edit of such a text does record.
- **Who may be mentioned.** A newly named person is recorded only while an ACTIVE member whose permissions read work items and whose role sees the item's project (`mentionableAmong`: Viewers yes; a GUEST none until 8.4); anyone else, an unknown id or another workspace's person is dropped silently and their token stays text.
- **Edits.** Only the people an edit adds are recorded and notified; a token removed removes its row (audited `WORK_ITEM_MENTIONS_REMOVED`) and notifies nobody; a deleted comment's rows are removed with it. The author may mention themselves (the chip shows), and is never notified or added as a watcher for it.
- **Watching** (decision 128). Each newly mentioned person (never the author) becomes a watcher in the same transaction, audited `WORK_ITEM_WATCHER_ADDED` with `metadata.reason: 'mentioned'`.
- **Audit.** `WORK_ITEM_MENTIONED` on the item, with the people's ids and the comment's id, never the text; Activity shows "mentioned someone" and "removed a mention".
- **Notifications** (decision 130), after the commit, through `emitMentionBells` (`work-item-shared.ts`): the `WORK_ITEM_MENTIONED` bell (`createMentionNotifications`, `src/app-layer/notifications/mention.ts`) and, when the person's preference is `IMMEDIATE` (the default), the `WORK_ITEM_MENTIONED` email. Both say who mentioned them, on which item, with a link; never the comment's or the description's text. The comment's watcher fan-out then skips the people it just mentioned (`skipUserIds`). Order: `tests/unit/usecases/work-item-sequence-order.test.ts`.
- No new route and no new key: the comment and item routes carry it.

### The views

- **The `@` picker** (`src/components/work-items/mentions/MentionTextarea.tsx`) on the comment box, the comment editor, the description editor and the create dialog's description: `@` at the start or after a space lists the workspace's active members (`GET /users/assignable`), narrowed by what follows; arrows move, Enter or Tab chooses, Escape closes; the keys are the text box's own `onKeyDown`, which keeps its textbox role (`aria-autocomplete`, `aria-activedescendant`).
- **Display** (`MentionText.tsx`): a comment's body, the description and the pinned answer show a recorded person's token as a chip with their current name, from the source's rows the server returns (`mentions` on each comment, `descriptionMentions` and `answer.mentions` on the detail). A work-item key in the text (`ISL-123`, upper case, a prefix of one of the workspace's projects) is a link to the item at display time (decision 131); nothing is stored for it, and the item page reads it through the authorised API. Everything is React text.
- **The description** is shown with its chips and links, and edited on request ("Edit description", then Save or Cancel).
- Copy is `workItems.mentions.*`, `workItems.detail.editDescription` and `workItems.activity.mentioned*`.

## Recipient lists (2.7e)

Built by [`docs/porting/maps/2.7.md`](porting/maps/2.7.md), part 6, under owner decisions 79 and 138 to 142 (`docs/HANDOFF.md`) and ADR 0006 ("Recipient list": never Group, Team or List alone). Written fresh; inflect-compliance has no distribution lists.

### The model

`RecipientList` (`tenantId`, `projectId` NULL for a workspace list, `name` plaintext and sanitised, at most 80, unique in its scope with archived lists included (two partial uniques), `description` at most 500, `archivedAt`, `createdById` an actor stamp) and `RecipientListMember` (`listId`, `userId`, `addedById`; the membership FK cascades, so a removed member leaves every list; at most 500 people a list). A project's lists cascade with the project. Lists are archived and restored, never deleted (decision 141): `app_user` holds no DELETE on `RecipientList`. RLS, grants and the two-tenant test `tests/integration/recipient-lists.test.ts`. Migration `20261206120000_recipient_lists`.

### Writes and who may make them

- **Keys** (decision 140). Workspace lists are managed under `admin.manage`, a project's under `projects.edit` (Members hold it); anyone who reads projects reads both (`projects.view`). The routes are split by scope, so each carries its scope's literal key and a refusal is the middleware's audited `AUTHZ_DENIED`: `/recipient-lists` (GET, POST), `/recipient-lists/:id` (GET, PATCH), `/recipient-lists/:id/members` (PUT the set, PATCH `{ add, remove }`), `/recipient-lists/:id/archive` and `/restore` (POST), and the same five under `/projects/:projectId/recipient-lists`. The usecases (`src/app-layer/usecases/recipient-list.ts`) assert the same predicates (`recipient-list.policies.ts`); a list named under the wrong scope is a 404. Pages read `recipientListAffordances` on the server.
- **Rules.** A person must be an ACTIVE member when added (400); a name taken in the scope is 409 `RECIPIENT_LIST_NAME_TAKEN` (writes in one scope take an advisory lock); an archived list is read-only (409 `RECIPIENT_LIST_ARCHIVED`) until restored; an archived project's lists are read-only (409 `PROJECT_ARCHIVED`). `GET /recipient-lists?projectId=` lists the live lists usable on that project's items (the workspace's and its own), `?usable=1` those of every visible project.
- **Audit.** `RECIPIENT_LIST_CREATED`, `_UPDATED`, `_MEMBERS_CHANGED` (the people's ids), `_ARCHIVED` and `_RESTORED`.
- **Adding a list to an item's watchers** (decision 139) copies the people the list resolves to now as ordinary watchers, each free to stop watching; later features that name a list resolve it when they send. `addRecipientListAsWatchers` takes `work_items.edit`, refuses another project's list (400) and an archived one (409), and adds only active members who read work items and see the item's project, through `resolveListRecipients` (`docs/notifications.md`, "Recipient lists (2.7e)"). Audited `WORK_ITEM_WATCHERS_ADDED_FROM_LIST`; Activity shows "added watchers from a recipient list".

### The views

- Settings → Recipient lists (`/settings/recipient-lists`) for the workspace's lists, behind the Settings gate; a project's lists at `/projects/<KEY>/recipient-lists`, linked from the project page's header and from Settings → Projects. Both are `RecipientListsView` (`src/components/recipient-lists/`): each list with its people, create and edit (name and description), add a person, remove one through the undo toast (`use-recipient-lists.ts`, in `SITE_CONTRACTS`), archive at once (not a delete) and restore from the folded "archived" group.
- The detail's watchers panel offers "Add recipient list" (the live lists usable on the item, workspace lists marked) to a member who may edit items.
- Settings → Intake picks the one list a project's intake also rings (decision 142; `docs/intake.md`).
- Copy is `recipientLists.*`, `settings.intake.recipientList*`, `settings.sections.recipientLists` and `workItems.detail.addRecipientList`.

## Reviews (2.8a)

Built by [`docs/porting/maps/2.8.md`](porting/maps/2.8.md) under owner decisions 148 to 165 (`docs/HANDOFF.md`) and [ADR 0009](adr/0009-review-steps.md). 2.8a is the backend: the tables, the lifecycle, the routes, the notifications and the reminders. The item detail's "Review steps" section and My Work's "To review" are 2.8b (see "Reviews (2.8b)" below); default steps per type and the per-type Done check are 2.8c (see "Reviews (2.8c)" below). Written fresh; four inflect-compliance patterns are recorded in `PROVENANCE.md` as pattern only.

### The words (decision 148)

A **Round** holds ordered **Review steps**; each step asks **Reviewers** (members, or recipient lists resolved when it opens), all of them or any one, due a number of working days after it opens; a reviewer responds **Signed off** or **Returned**. My Work's section is "To review". "Review" alone stays the proposal page's word (6.2). ADR 0006 has the rows.

### The model

Migration `20261208120600_reviews` (the enum values in `20261208120000` to `20261208120500`, each alone), `prisma/schema/reviews.prisma`:

- `WorkItemReviewRound` (`number` per item, `status` `PLANNED` `OPEN` `COMPLETED` `RETURNED` `WITHDRAWN`, who sent it and when, how it ended, `version`). At most one `PLANNED` or `OPEN` round per item (a partial unique). `app_user` holds no DELETE.
- `WorkItemReviewStep` (`position`, `name` sanitised and at most 120, `mode` `ALL` or `ANY`, `dueInWorkingDays` 1 to 60, `status` `PENDING` `OPEN` `COMPLETED` `RETURNED` `SKIPPED` `WITHDRAWN`, `openedAt`, date-only `dueOn`, the skip's who and why). At most one `OPEN` step per round.
- `WorkItemReviewStepList`: the recipient lists a step names (the list FK is RESTRICT: lists are never deleted).
- `WorkItemReviewer`: one row per person per step (`userId` an FK to `User`, so a departed reviewer's response outlives their membership; `viaRecipientListId` for "via Legal"), the response (`outcome`, `respondedAt`, `responseText` ENCRYPTED and sanitised, `itemVersionAt`) and the withdrawal (`withdrawnAt`, `withdrawnReason` `MEMBER_REMOVED` `STEP_ENDED` `REMOVED_BY_PERSON` `BECAME_ASSIGNEE` `NOT_ELIGIBLE`). `app_user` holds no DELETE: a person is withdrawn, never removed.
- CHECKs on every code column and on the response (a Return has text, decision 157; a response and a withdrawal are never both set).
- **The record is never rewritten** (ADR 0009 §3 and §4; decision 162). Triggers refuse any change to an ended round, to any step, step list or reviewer row of one, to an ended step and its reviewers' responses, to a step's name, mode, days or position once it has opened, a response taken back, a withdrawn row changed, and a direct delete of anything but a step not yet opened. The one admitted change is the key rotations' re-wrap of `responseText` (one ciphertext for another, every other column unchanged); the item's purge and the workspace's delete cascade past them (`pg_trigger_depth() > 1`).
- RLS, grants and the two-tenant test `tests/integration/reviews.test.ts`.

### The lifecycle

The usecases are `src/app-layer/usecases/review.ts`; the in-transaction core, shared with the other paths, is `review-engine.ts`; the pure rules are `src/app-layer/domain/review-steps.ts` (`evaluateStep`, `nextPendingStep`, `afterStepEnds`) and `working-days.ts` (`addWorkingDays`), both property-tested. Every write locks the item's row first (`ReviewRepository.lockItem`), so responses, skips, edits, sends and a waiting-on write serialise.

1. **Planned.** `PUT …/review/steps` replaces the steps not yet opened: every step of the planned round (one is created when the item has none) or the steps after the open one. Each step names at least one member or list; a member must be an ACTIVE member with `work_items.view` who sees the project (400 `REVIEWER_NOT_ELIGIBLE`), never the item's assignee (400 `REVIEWER_IS_ASSIGNEE`, decision 158); a list must be live and the workspace's or the item's project's. `If-Match` names the round's version once there is one (428 without, 409 stale).
2. **Send** (decision 155). `POST …/review/send` opens the planned round's first step. Refused for a closed item (`ITEM_CLOSED`), a round with no steps (`NO_STEPS`), or any step nobody can be asked at now (409 `NO_REVIEWERS`): zero is never complete.
3. **A step opens.** Its lists are resolved through `resolveListRecipients` (decision 154; `may: work_items.view`, the item's project) and their people become reviewer rows beside the named members, each person once; the assignee and anyone who may no longer be asked are dropped (named members withdrawn `BECAME_ASSIGNEE` or `NOT_ELIGIBLE`) and named in the audit entry. `dueOn` is today in `NOTIFICATIONS_TZ` plus the step's working days, Monday to Friday (decision 151), stored once. A step that opens after another completes with nobody to ask opens flagged ("no reviewers left") and its owners are told; it never completes.
4. **A response** (`POST …/review/steps/:stepId/respond { outcome, text? }`). Only the named reviewer, acting as a person (`assertActingAsPerson`: an API key is 403 `NOT_A_PERSON`), never the item's assignee; any other caller is a 403 audited `AUTHZ_DENIED` (`REVIEWER_NOT_NAMED`, `REVIEWER_IS_ASSIGNEE`). A Return needs text (400 `RETURN_NEEDS_TEXT`). The row is claimed with one conditional `updateMany` (409 `REVIEW_RESPONSE_TAKEN` on a lost race); a step that is no longer open is 409 `REVIEW_STEP_NOT_OPEN`. The response records the item's `version` (decision 163: the item stays editable; 2.8b shows "changed since signed off"). **A reviewer may change their response while the step is open** (decision 162), audited `WORK_ITEM_REVIEW_RESPONSE_CHANGED`; from the step's end it is frozen.
5. **The step is decided** (`evaluateStep`). An "all" step completes when every reviewer still asked has signed off and at least one has; one Return returns it at once and withdraws the others still pending (decision 156). An "any" step is decided by its first response. A completed (or skipped) step opens the next one, or completes the round.
6. **A Return** ends the round `RETURNED`; its other steps end `WITHDRAWN` and nothing in it is rewritten. A new round (`number + 1`, `PLANNED`) is planned at once with the same steps: names, modes, working days, named members (not those removed, withdrawn by a person or made the assignee) and live lists, never the resolved people. It waits until a person sends it.
7. **Skip** (`POST …/review/steps/:stepId/skip`, decision 150): an open or pending step of the open round, by the item's assignee, whoever sent the round, or an admin (`admin.manage`); anyone else is a 403 audited. An open step nobody is left to answer closes with reason `NO_REVIEWERS_LEFT` ("closing a step whose reviewers left"); otherwise `PERSON_SKIPPED`. Never a response.
8. **Reviewers added and removed.** `POST …/review/steps/:stepId/reviewers { userId }` adds a person to a step that has not ended (`work_items.edit`; asked at once on an open step); `DELETE …/reviewers/:userId` withdraws a pending reviewer (`REMOVED_BY_PERSON`), on an open step only with the standing of decision 150, since it can complete the step. A withdrawn person is not added back to the same step (409).
9. **Withdraw** (`POST …/review/withdraw`, `work_items.edit`): the open round ends `WITHDRAWN` (`WITHDRAWN_BY_PERSON`), its record unchanged, and a planned round with the same steps follows.
10. **Closing and deleting** (decision 149). Every state path into `DONE` or `CANCELLED` (single, bulk, the board move, a duplicate mark, a state's delete, the answer) ends an open round `WITHDRAWN` (`ITEM_CLOSED`) in the same transaction (`endOpenRoundsOnClose`, `endOpenRoundsInState`; `tests/guards/review-close-paths.test.ts` pins the paths), and a delete does (`ITEM_DELETED`). A planned round stays planned; a reopen or a restore does not reopen anything. Before any of them writes, the Done check a type may require runs (2.8c, below).
11. **Member removal** withdraws the member's pending rows (`MEMBER_REMOVED`) before the membership goes, audited `WORK_ITEM_REVIEWERS_WITHDRAWN_ON_MEMBER_REMOVAL`, and decides each open step again: a step left with nobody stays open, flagged, and its owners are told.
12. **An assignee change** (decision 158) that makes a pending reviewer the assignee withdraws their rows (`BECAME_ASSIGNEE`), audited `WORK_ITEM_REVIEWER_WITHDRAWN`, and decides the step again.
13. **A move to another project** keeps the rounds; a reviewer who cannot see the new project stays asked until 8.4 (a known limit, ADR 0009).

### Waiting on (decisions 152 and 153)

`WorkItem.waitingOnUserId` stays one person. Sending a round clears it (audited `WORK_ITEM_WAITING_ON_CHANGED`, `summary: review_round_opened`): while a round is open the item waits on the open step's pending reviewers, read from their rows (`waitingOnReviewerIds` in the review response; `GET /work-items?reviewerId=me` lists the items whose open step still asks the caller, any user id or `me`). A round that completes or is returned names the assignee (an ACTIVE member, the item open); a withdrawn round sets nothing. Setting waiting on by hand while a round is open is 409 `REVIEW_ROUND_OPEN`, and 6.3's agent-session reference will follow the same rule.

### Keys (decision 160)

No new domain: `GET …/review` and the respond route take `work_items.view`; every other review route takes `work_items.edit`; each has a literal `requirePermission` and a `route-permissions.ts` rule (`tests/guards/tenant-crud-authz-coverage.test.ts`). The usecases assert the rest from `src/app-layer/policies/review.policies.ts` (`reviewStandingBasis`, `isOwnWork`, `mayRespondToReview`), and `GET …/review` returns `viewer` (`reviewAffordances`) for the detail; a component never restates a rule. `tests/integration/review-api.test.ts` drives every review route as each role.

### Audit and Activity

`WORK_ITEM_REVIEW_STEPS_CHANGED`, `_ROUND_STARTED`, `_STEP_OPENED`, `_RESPONDED`, `_RESPONSE_CHANGED`, `_STEP_SKIPPED`, `_ROUND_ENDED`, `WORK_ITEM_REVIEWERS_CHANGED` and `WORK_ITEM_REVIEWER_WITHDRAWN` on the item (each in its Activity), ids and outcomes only, never a step's text or a response's. Only `respondToReviewStep` writes a response (`tests/guards/review-response-seam.test.ts`).

## Reviews (2.8b)

The review UI on 2.8a's API: the item detail's "Review steps" section, the list's review column and filter, the board card's mark, and My Work's "To review". Built by [`docs/porting/maps/2.8.md`](porting/maps/2.8.md) (its 2.8b part) under owner decisions 148 to 165. Written fresh.

- **The section** (`src/components/work-items/detail/ReviewSteps.tsx`) is on the Overview of the page and the sheet. It reads `GET …/review` through `useWorkItemReview` (`src/components/work-items/data/use-review.ts`, one SWR key the page and the sheet share) and shows the live round's steps in order, each with its name, "All must sign off" or "Any one signs off", its due day (or how many working days after it opens it falls due), its status, its recipient lists and its reviewers: each with "Pending", "Signed off" or "Returned" (the words of decision 148), when they responded, their text, "via <list>" for a list's people, and why a withdrawn one was withdrawn. A step nobody is left to answer says so. The earlier rounds are listed below it, folded and read-only ("Round 1: Returned by Cy on …"); while a round planned after a Return waits to be sent, the section says so.
- **Every button is the server's** (`viewer`, `reviewAffordances`): "Add review step", and on each step not yet opened "Edit", "Move up", "Move down" and "Remove" (`editSteps`); "Send for review" (`send`); "Withdraw the round" (`withdraw`); "Skip step", or "Close step" when nobody is left (`skip`); "Add a reviewer" on the open step (`editSteps`) and "Remove" on a pending reviewer of the open step (`skip`, decision 150's standing); "Sign off" and "Return" for the viewer named on the open step (`respondStepId`). The component asks no role, key or assignee.
- **Editing.** The editor dialog edits one step: its name, all or any, its working days (1 to 60), its members (the roster) and its recipient lists (the workspace's and the project's live ones). Every change, a reorder included, is one `PUT …/review/steps` of the steps not yet opened, in order, with the round's version as `If-Match` once there is one; the server's refusal (the assignee named, `REVIEWER_IS_ASSIGNEE`; someone who cannot see the project; a stale version) is shown in the dialog. Send, withdraw and skip send the round's version too (`tests/guards/work-item-views-shared-query.test.ts`).
- **Removals go through the undo toast** (`SITE_CONTRACTS`): removing a reviewer (`DELETE …/reviewers/:userId`) and removing a step not yet opened (the remaining steps' PUT) leave the section at once and are sent when the window closes; Undo sends nothing.
- **Responding** (decisions 157 and 162). "Sign off" and "Return" open a dialog with the text: optional to sign off, required to Return (said in the dialog before anything is sent; the server refuses it too). A reviewer who has responded is told so and may change it while the step is open; the dialog starts from their text when the outcome is the same.
- **"Changed since signed off"** (decision 163, `changedSinceSignedOff` in `domain/review-steps.ts`): a sign-off whose `itemVersionAt` is below the item's version, while its round is open. An ended round is not marked: ending it names the assignee as waited on, which is itself a write of the item, so the version no longer says whether the work changed.
- **Waiting on** (decisions 152 and 153). While a round is open the detail's "Waiting on" shows the open step's pending reviewers, read-only (`useReviewWaitingOn`, from `waitingOnReviewerIds`); the picker returns when the round ends.
- **After a write** the answer (the fresh review) replaces the cached one, the item is read again and placed in every list (sending clears waiting on; an ended round names the assignee), the Activity is read again, and the lists filtered by reviewer or "waiting on me" are read again (`filtersByReviewer`, `waitsOnMe`): the client cannot place a row in them.
- **The list and the board.** Every row carries `review` (`ReviewSummary`, from `reviewSummaryOf` over the item's two newest rounds, `toWorkItemDto`): `open` with the open step's name, due day and pending count, `signedOff`, `returned` (the last ended round, while the next waits to be sent), `withdrawn`, or `planned`; null for an item with no review. The list's `review` column (the column gear; hidden by default) and My Work's sections show it as "Legal: 2 pending · due 2026-11-25", "Signed off", "Returned"; the board card shows a short mark ("Review: Returned"). There is no review lane: a step names several people. The `reviewerId` filter ("Reviewer", the roster) is in `WORK_ITEM_FILTER_KEYS` and the saved-view `FilterKey`; the client never places a row in a list filtered by it.
- **My Work's "To review"** (decision 152) is the first section: `reviewerId=me` (the server reads the caller), the items whose open step still asks them, not yet answered, with its count, its empty state and "Load more", in manual order like the others (no sort by the step's due day: the list has no such sort; the row shows the due day).
- **Planning again.** With no live round (after a completed round, or one withdrawn when the item closed) `editSteps` is offered: the PUT plans a new round (2.8b widened `reviewAffordances`, which offered it only with a live round).
- **Notifications.** The Inbox and the preferences page list the four review types from `PREFERENCE_TYPES` (2.8a); 2.8b adds no keyboard shortcut, so the shortcut help is unchanged.
- **Copy** is `workItems.review.*`, `workItems.col.review`, `workItems.filters.reviewer` and `workItems.myWork.sections.toReview.*`.
- **Tests.** `tests/rendered/review-steps.test.tsx` (a named reviewer, anyone else, the earlier rounds, the editor, sending, reordering, the undo toasts, skip; jest-axe), `work-item-detail.test.tsx` (the section on the page and the sheet, waiting on read-only), `my-work.test.tsx`, `work-item-board.test.tsx`, `tests/unit/policies/review-affordances.test.ts`, `tests/unit/domain/review-steps.test.ts`, the summary in `tests/integration/reviews.test.ts`, and the E2E `tests/e2e/reviews.spec.ts` (an owner sets two steps and sends; one member signs off; a third returns with text; the assignee sees "Returned" and is waited on again).

## Reviews (2.8c)

Default review steps per work item type and the per-type Done check. Built by [`docs/porting/maps/2.8.md`](porting/maps/2.8.md) (its 2.8c part) under owner decisions 149, 158, 159 and 160 and [ADR 0009](adr/0009-review-steps.md) §14 and §15. Written fresh.

- **Model** (migration `20261209120000_type_review_steps`). `WorkItemType.reviewRequiredForDone` (default false); `WorkItemTypeReviewStep` (per type across the workspace: `position`, `name` CHECKed 1 to 120, `mode`, `dueInWorkingDays` CHECKed 1 to 60; unique `(typeId, position)`; cascades with the type) and `WorkItemTypeReviewStepReviewer` (exactly one of a member, by the membership FK that cascades so a removed member leaves every default, or a recipient list, NO ACTION; the CHECK `WorkItemTypeReviewStepReviewer_one_target`). Both are tenant tables with the canonical RLS; a type's defaults are replaced as a whole, so `app_user` holds DELETE.
- **Keys** (decision 160). `GET /work-item-types/:typeId/review-steps` takes `projects.view`; `PUT` (the whole set and the switch: `{ reviewRequiredForDone, steps }`) takes `admin.manage`, as a type's built-in field rules do. A default step names ACTIVE members and the workspace's live lists only (a type spans every project: a project's list is 400 `RECIPIENT_LIST_NOT_USABLE`), and names somebody (`STEP_HAS_NO_REVIEWERS`). Audited `WORK_ITEM_TYPE_REVIEW_STEPS_SET` with ids and counts, never a step's name. `src/app-layer/usecases/review-defaults.ts`.
- **Copying** (decision 159). `copyTypeReviewDefaultsInTx` is the one path from a type's defaults to an item, called in the create's own transaction by both in-transaction creates, `createWorkItemInTx` and `insertTemplateItemInTx`: so the dialog and the API, template sub-items, project-template starter items, intake accept and repeat copies (made as the repeat's owner) all copy. The copy is round 1, `PLANNED`, never sent (decision 155); a later change to the defaults changes no item, and a type change on an item copies nothing (the 2.4b rule). `tests/guards/review-defaults-copy-paths.test.ts` holds every writer of a new work item to it. Who is copied is decided when the item is made:
  - **the item's assignee is dropped** (decision 158). Dropping, not refusing, because a template, an intake accept or a repeat copy cannot be refused for it, and it is what a list's resolution and an assignee change already do; the person edits steps afterwards under 2.8a's `REVIEWER_IS_ASSIGNEE`;
  - a member who may not review the item now (not ACTIVE, or not seeing its project, such as a GUEST) is dropped, and so is an archived list;
  - what was dropped is named in `WORK_ITEM_CREATED` (`reviewStepsFromType`, `reviewDefaultsDropped`, `reviewDefaultListsDropped`);
  - a step left naming nobody is kept, so the item still shows the review its type asks for; it cannot be sent until somebody is named (`NO_REVIEWERS`).
- **The Done check** (decision 149). Every state path into `DONE` asks `assertReviewAllowsDone` before it writes: a single state change, bulk (all or nothing, naming the held item; `details.workItemIds` lists every held one), the board move and marking an answer (2.4b-c; the mark is refused whole). A state's delete that moves its items into a Done state asks `assertReviewAllowsDoneInState`, counting deleted items too (a restore would bring one back into the target), and is refused naming how many are held. A create into a Done state of a type that requires review and has default steps is refused too (`details.atCreate`), since the round it copies has not been sent. `tests/guards/review-done-paths.test.ts` holds every caller of `stateTransitionEffects` to it; marking a duplicate, which only cancels, is named there.
  - **The rule** is the pure `reviewHoldsDone` (`domain/review-steps.ts`): for an item whose type requires review, the newest round with at least one step must be `COMPLETED`. Planned, open, returned (a new round is planned after it) and withdrawn (by a person, or because the item was closed or deleted while it was open) all hold. An item with no round with steps is not held: a type that requires review but has no default steps holds nothing (Settings says so), and a planned round emptied of its steps is no review (as the row's summary reads it; the removal is audited). A new round planned after a completed one holds until it completes.
  - **The refusal** is 409 `REVIEW_INCOMPLETE` with `roundNumber` and `roundStatus` and a sentence that names the item, the round and, for an open round, its open step (`reviewHoldMessage`), and says cancelling is always allowed. A move into `CANCELLED`, or between two Done states, is never held. The check takes the items' row locks (`ReviewRepository.lockItems`, in id order), the lock every review write takes, so a round cannot be planned or reopened between the check and the move.
  - **Nobody overrides it**: a person, an admin and a job are held alike. No system or job path moves an item into Done today (the cycle rollover changes cycles, never states; the due and digest jobs write no state). Repeats create items: a copy is made in its team's default state, so it is held only if that default is a Done state, in which case the nightly run counts the rule as failed (not a hold: no `RecurrenceHold` value names it) until the team's default changes.
- **Project templates** carry no review steps (the map: the type's defaults apply at create). A project made from a template uses the same workspace types, so its starter items copy the defaults like any create.
- **Settings → a type → Review steps** (`settings/work-item-types/[typeId]/review-steps`, `WorkItemTypeReviewStepsSettings`, data in `use-type-review-steps.ts`): the steps in order with whom each names (an archived list is marked "not copied"; a step naming nobody says so), "Review step" (2.8b's step editor, `StepEditorDialog` with `projectId` null, which offers the workspace's lists only), Edit, Up, Down and Remove, and the switch "Review must finish before Done", with a note when it is on and there are no default steps. Every write is the whole set; removing a step goes through the undo toast (`SITE_CONTRACTS`). The writes are offered only with `workConfigAffordances().manageWorkConfig` (`settingsPageAccess`). The types list links each type to its review steps and marks the ones that hold Done; a type's fields page links there too. Copy is `settings.typeReviewSteps.*`, `settings.types.reviewSteps*` and `workItems.review.editor.workspaceListsHint`.
- **The refusal in the views.** The board drop, the detail's state change and the bulk action roll back and show the server's sentence (a 409 that is not `VERSION_CONFLICT` is never retried; `useWorkItemMutations`).
- **Tests.** `tests/integration/review-defaults.test.ts` (the two-tenant isolation, the route matrix, setting the defaults, every create path copying, every Done path refused and the cases not held, the audit chain), `tests/integration/work-items-api.test.ts` (the route as each role), `tests/unit/domain/review-steps.test.ts` (`reviewHoldsDone`, property-tested), the two guards, `tests/rendered/type-review-steps.test.tsx`, the refusal cases in `work-item-board.test.tsx` and `work-item-mutations.test.tsx`, and the E2E `tests/e2e/type-review-steps.spec.ts` (an admin sets a default on a type; a new item has the step; a board drop into Done is refused until its review is signed off).

## Settings (decision 55)

A workspace admin configures work without the API on the Settings pages (`src/app/t/[tenantSlug]/(app)/settings/`, components in `src/components/settings/`), built on 2.2's routes with no new route or usecase:

| Page | Reads | Offers |
|---|---|---|
| Settings (`/settings`) | teams, types, labels, projects (counts) | one card per section; while no open project exists, the first-project steps (a team, then a project, then work items), each step's state read from the server |
| Teams (`/settings/teams`) | `GET /teams` | create (the server seeds the workflow, and for a first team the types), rename, delete |
| A team's workflow (`/settings/teams/<id>`) | `GET /teams/<id>` | create a state with a category fixed from then on, rename, move up or down within its category, make default, archive and unarchive, delete moving its items to a state the person chooses |
| Work item types (`/settings/work-item-types`) | `GET /work-item-types?includeArchived=1` | create, rename, archive and unarchive |
| Labels (`/settings/labels`) | `GET /labels` | create for the workspace or one team, rename, delete |
| Projects (`/settings/projects`) | `GET /projects?includeArchived=1` | create (team, name, key prefix), rename, archive behind a typed confirmation (the key prefix), unarchive; a link to each project's recipient lists (2.7e) |
| Recipient lists (`/settings/recipient-lists`, 2.7e) | `GET /recipient-lists?includeArchived=1` | create, edit, add and remove people, archive and restore workspace lists (see "Recipient lists (2.7e)") |

- **Who sees what.** Every page asks `mayOpenSettings` on the server (`settingsPageAccess`, `src/lib/server/settings-pages.server.ts`), the sidebar gear's rule; anybody else gets a 404. The writes each page offers are `workConfigAffordances` (`work-config.policies.ts`), built from the same predicates the usecases assert (`mayManageWorkConfig`, `mayCreateProject`, `mayEditProject`, `mayArchiveProject`), so an Admin whose custom role withholds `admin.manage` reads the configuration and is offered no change to it. No component restates decision 52.
- **Writes.** `apiSend` through `useSettingsApi` (`settings-data.ts`), then the list is read again; a refusal is shown as the server words it, in the dialog for a create or rename, as a toast otherwise. Deletes (a team, a state, a label) leave the list at once and are sent from inside the undo toast (`use-undo-delete.ts`, listed in `SITE_CONTRACTS`); a refusal that arrives when the window closes (a team with projects) puts the row back with the reason. Archiving a project is a typed confirmation, because its work items stop taking changes.
- **The workflow order.** `workflow-order.ts` lists a team's states by category in workflow order, and a move names the neighbour in the same category, so a state never leaves its category by being moved.
- **Not offered (decisions for this pull request).** Project delete and restore, a key-prefix change, type icons, colours and order, and label colours stay API-only. Settings stays admin-only through `mayOpenSettings`; a Member, who holds `projects.create`, creates a project from the Projects page instead (decision 57, "Views (2.3)"), through the same dialog.

## Intake (2.6a)

Requests from forms wait in intake, outside `WorkItem` (ADR 0002 "Consequences"), until a person accepts, declines, merges or snoozes them. Accepting creates the item through `createWorkItemInTx`, the create path's in-transaction core that `createWorkItem` also runs, so an accepted request is created exactly as any item is, its `WORK_ITEM_CREATED` entry naming the request. See [docs/intake.md](intake.md).
