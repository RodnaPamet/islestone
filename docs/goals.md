# Goals and initiatives

Sub-phase 3.2 (`docs/porting/maps/3.2.md`; ADR 0002 §2 and §17; ADR 0006 "Goal and roadmap words of sub-phase 3.2"; owner decisions 205 to 224). This page describes what is built. **3.2a is built**: the model, an item's direct goal, archive, soft delete, restore and the purge, the routes, the ancestry and the list's filters. Progress, health and the Goals and Initiatives pages are 3.2b's; the roadmap is 3.2c's. None of them exists yet.

## The chain

Goal → initiative → project → work item → sub-item, each link single-parent and nullable (ADR 0002 §2). A project never names a goal. In addition a work item may name **one goal directly** (`WorkItem.goalId`, decision 211), which may be a goal its project's initiative does not serve. Nothing is inherited downward: a sub-item does not take its parent's goal, a new item does not take its project's initiative's goal, and moving a project to another initiative rewrites no item.

Goals and initiatives are records above projects, never work items (principle 3): they never appear in the work-item list, board, search or any item read.

## The model

`prisma/schema/goals.prisma`; migrations `20261215120000_goals_and_initiatives`, `20261215120100_project_initiative_and_item_goal` and `20261215120200_field_set_goal`.

| Field | Goal | Initiative |
|---|---|---|
| Label | `title`, plaintext, 1..200 (CHECK) | `name`, plaintext, 1..120 (CHECK) |
| Parent | `parentId` (a goal; at most three levels) | `goalId` |
| Description | encrypted (the manifest), sanitised, at most 10,000 characters before encryption; never audited, never search-indexed (ADR 0008) | the same |
| Status | `GoalStatus`: Planned, Started, Completed, Cancelled (decision 208), any order | `InitiativeStatus`, the same four |
| Due date | date-only, optional; not a scheduling-engine deadline (decision 210) | the same |
| Lead | `leadUserId`: one ACTIVE member, any role but Guest (decision 209); RESTRICT, cleared on member removal | the same |
| Health | `Health` and who set it when (decisions 205 and 214); written from 3.2b, never by 3.2a | the same |
| Archive | `archivedAt`, only while Completed or Cancelled (CHECK) | the same |
| Soft delete | `deletedAt`, `deletedByUserId`, `deletionId` (both or neither, CHECK) | the same |

`Project.initiativeId` names at most one initiative; `WorkItem.goalId` one goal. The four links (`Goal.parentId`, `Initiative.goalId`, `Project.initiativeId`, `WorkItem.goalId`) are composite keys to `(id, tenantId)`, each `ON DELETE SET NULL` on its own column, so the purge alone deletes a row and the database clears every link to it without touching `tenantId`. Prisma cannot declare the column list; the migrations do, and `tests/integration/goals.test.ts` reads it from the catalogue.

Both tables are tenant tables with the standard policies; `app_user` holds DELETE on them for the purge alone. The transition trigger does not watch `goalId`. `[tenantId, goalId, stateCategory]` backs the item's goal key, the `goalId` filter and (3.2b) a goal's direct items; the project-path progress index `[tenantId, projectId, stateCategory]` lands with 3.2b's counts (on the 10k seed it moved three existing list and job plans off their indexes, so 3.2a does not add it unused).

## The tree rules

- **One lock.** Every write that changes `Goal.parentId` or `Initiative.goalId`, and every goal delete, restore and purge page, takes `lockGoalTree` first (`src/app-layer/usecases/goal-tree-lock.ts`, `pg_advisory_xact_lock(hashtext('goal-tree:' || tenantId))`), before any project or item row. Setting an item's goal does not take it; the goal is read `FOR KEY SHARE`.
- **Same workspace.** A parent goal, an initiative's goal, a project's initiative and an item's goal are read `FOR KEY SHARE` in the caller's workspace (Paperclip's check, pattern only); the composite key refuses another workspace's id anyway.
- **No cycle, three levels.** Re-parenting refuses a new parent inside the goal's own subtree (`GOAL_WOULD_CYCLE`) and a new parent whose level plus the moved subtree's height passes three (`GOAL_TOO_DEEP`, naming the depth). Deleted goals are counted, so a restore can never break either. The rules are the pure `src/app-layer/domain/goal-tree.ts`.
- **New links.** A deleted goal or initiative is 404 (`GOAL_NOT_FOUND`, `INITIATIVE_NOT_FOUND`) to every read and every write naming it; an archived one takes no new link (409 `GOAL_ARCHIVED`, `INITIATIVE_ARCHIVED`): no new child goal, initiative, project or item. A goal already under an archived parent stays.

## Archive, delete, restore and the purge

- **Archive** (`POST /goals/:id/archive { archived }`, the same for initiatives): only a Completed or Cancelled one (409 `GOAL_NOT_FINISHED` / `INITIATIVE_NOT_FINISHED`). An archived one keeps its children and links and its place in every ancestry (shown archived), leaves the lists and pickers unless `archived=true`, and is read-only until unarchived (409 `ARCHIVED`). Archiving archives nothing below it.
- **Delete** (`DELETE /goals/:id`): the goal, every live goal below it and the live initiatives of all of them get one new `deletionId` (at most 2,000 goals, 409 `GOAL_TREE_TOO_LARGE` above). `DELETE /initiatives/:id` is its own group. Projects keep `initiativeId` and items keep `goalId`; every read leaves the deleted rows out (a project whose initiative is deleted shows none in its ancestry; the walk stops at a deleted goal).
- **Restore** (`POST /goals/:id/restore`, `POST /initiatives/:id/restore`) brings the group back, links intact, only through the group's root (409 `DELETED_WITH_PARENT`, `details.rootId`) and only while the root's parent is live (409 `PARENT_DELETED`, `details.parentId`). An initiative deleted with its goal restores through that goal.
- **The purge** is the nightly `goal-purge` job (02:35 UTC, after the work-item purge): in every live workspace holding rows deleted more than `GOAL_PURGE_DAYS` (30) ago, as its system user, pages of 200 in id order, initiatives then goals, each page under the tree lock. Before a page of goals is deleted, the items naming them are locked in id order (`WorkItemRepository.lockItemsNamingGoals`, decision 173) and counted, and so are the projects naming a page of initiatives. The database clears the links; the unlink writes no item audit entry, bumps no version and fires no transition. One counts-only `GOALS_PURGED` entry per workspace (goals, initiatives, projects and items unlinked), never a title.

## A project's initiative and an item's goal

- `PUT /projects/:id/initiative { initiativeId | null }` (`projects.edit`; naming one also asks `goals.view`): a versioned project write (`If-Match` optional), audited `PROJECT_UPDATED` naming `initiativeId`. An archived project may be linked. `POST /projects` accepts `initiativeId` under the same checks; project templates carry none.
- `PUT /work-items/:id/goal { goalId | null }` (`work_items.edit`; naming one also asks `goals.view`, clearing only the edit key): a single-field versioned write (`If-Match` optional) through `loadWritableItem` and the field set (`goal` is a configurable built-in field, decision 211), audited `WORK_ITEM_GOAL_CHANGED` with the old and new ids; then the watcher fan-out. Closed items may be given or cleared a goal. Every create path takes `goalId` (`createWorkItemInTx`: the dialog, the API, intake accept); template items never carry one.
- A move to another project or team keeps the goal. A repeat copy takes its source's goal through `templateToCreateInput`, skipped and named when it no longer links (`goal:deleted`, `goal:archived`, `goal:unreadable` when the copy's owner may not read goals), never a refusal.

## The ancestry

`GET /work-items/:id/ancestry` (`work_items.view`; 404 when the item is missing or invisible) runs `WorkItemRepository.ancestry`: one `WITH RECURSIVE` statement, three recursive terms (up `parentId`, at most 5; from the project's live initiative up its goal's parents; from the item's own `goalId` up its parents; each goal chain at most 3), each depth-capped and path-guarded, each carrying `tenantId`, `deletedAt` and the caller's project visibility in its own `WHERE`, never a description. `assembleAncestry` turns the rows into `WorkItemAncestry` (`src/lib/goals/types.ts`): parents, project, initiative and goals root-first, and the direct goal's chain. A caller without `goals.view` gets the initiative and goals withheld and counted in `hiddenLevels`.

The detail (page and sheet) shows it above the title (`AncestryBreadcrumb`): "Goal › Initiative › Project › parents", and "Also serves: …" when the item's own goal is not one of the path's goals.

## The list's filters

`goalId` and `initiativeId` (comma-joinable ids; decision 220), in `WORK_ITEM_FILTER_KEYS`, the saved-view `FilterKey` and `LIST_FILTER_KEYS`, are resolved by `resolveListFiltersInTx` (so the list, the board and the timeline share them) and ask `goals.view`. `initiativeId` becomes the initiatives' visible projects; `goalId` becomes each goal's live subtree and the visible projects of those goals' live initiatives, and an item matches when its project is in the set OR its own `goalId` is in the subtree (each item once). A deleted or unknown target is 404; a scope reaching more than 1,000 projects is 422 `GOAL_SCOPE_TOO_LARGE` with the count, never cut. The client never decides either (`rowBelongs` answers "unknown").

## Keys

The `goals` domain (decision 213): `goals.view` reads goals and initiatives, `goals.manage` creates, changes, archives, deletes and restores them. Owners, Admins and Members hold both, Viewers `view`, a Guest nothing (decision 204). Every route is a literal `requirePermission` with a `route-permissions.ts` rule, a `tenant-crud-authz-coverage` pin and permission-matrix rows. Pages read `goalAffordances` (`goal.policies.ts`) on the server: Settings → Projects' Initiative column and "Change initiative", and the project create dialog's Initiative picker.

## Routes

| Route | Key | Usecase |
|---|---|---|
| `GET`/`POST /goals` | `goals.view` / `goals.manage` | `listGoals`, `createGoal` |
| `GET`/`PATCH`/`DELETE /goals/:id` | `goals.view` / `goals.manage` | `getGoal`, `updateGoal` (`If-Match` for title or description; `GOAL_MOVED` for a parent change), `deleteGoal` |
| `POST /goals/:id/archive`, `…/restore` | `goals.manage` | `setGoalArchived`, `restoreGoal` |
| `GET`/`POST /initiatives`, `GET`/`PATCH`/`DELETE /initiatives/:id`, `…/archive`, `…/restore` | as for goals | `initiative.ts` (`INITIATIVE_MOVED` for a goal change) |
| `PUT /projects/:id/initiative` | `projects.edit` | `setProjectInitiative` |
| `PUT /work-items/:id/goal` | `work_items.edit` | `setWorkItemGoal` |
| `GET /work-items/:id/ancestry` | `work_items.view` | `getWorkItemAncestry` |

Every write is audited in its transaction, naming changed fields and never the description: `GOAL_CREATED`, `GOAL_UPDATED`, `GOAL_MOVED`, `GOAL_ARCHIVED`, `GOAL_UNARCHIVED`, `GOAL_DELETED` (the group's ids and counts), `GOAL_RESTORED`, the same `INITIATIVE_*`, `PROJECT_UPDATED` naming `initiativeId`, `WORK_ITEM_GOAL_CHANGED`, a lead cleared on member removal (`GOAL_UPDATED` / `INITIATIVE_UPDATED`, `reason: 'member_removed'`), and `GOALS_PURGED`.

## Later

Progress over both paths (`domain/progress.ts`), health set by a person, the Roadmap sidebar entry with the Goals and Initiatives pages, and a goal's and an initiative's pages are 3.2b; the roadmap is 3.2c. 3.4's estimates may later weight progress by points; that is a later decision.
