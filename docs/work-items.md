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

Routes live under `/api/t/<slug>/work-items`, `/projects`, `/teams`, `/work-item-types` and `/labels`. Every method is a literal `requirePermission` with a rule in `route-permissions.ts`, so a refusal writes an `AUTHZ_DENIED` row; `tests/guards/tenant-crud-authz-coverage.test.ts` pins each key and `tests/integration/work-items-api.test.ts` drives every route as a VIEWER, a MEMBER and a GUEST.

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
