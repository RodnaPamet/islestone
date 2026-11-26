# Goals and initiatives

Sub-phase 3.2 (`docs/porting/maps/3.2.md`; ADR 0002 §2 and §17; ADR 0006 "Goal and roadmap words of sub-phase 3.2"; owner decisions 205 to 224). This page describes what is built. **All of 3.2 is built**: the model, an item's direct goal, archive, soft delete, restore and the purge, the routes, the ancestry and the list's filters (3.2a); progress, health, the Roadmap sidebar entry with the Goals and Initiatives pages, and a goal's and an initiative's pages (3.2b); the roadmap, its read, its chart and table and the Roadmap page (3.2c).

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
| Health | `Health` and who set it when (decisions 205 and 214), set by a person only (below) | the same |
| Archive | `archivedAt`, only while Completed or Cancelled (CHECK) | the same |
| Soft delete | `deletedAt`, `deletedByUserId`, `deletionId` (both or neither, CHECK) | the same |

`Project.initiativeId` names at most one initiative; `WorkItem.goalId` one goal (migration `20261215120100`); the progress index is migration `20261216120000_work_item_progress_index` (below). The four links (`Goal.parentId`, `Initiative.goalId`, `Project.initiativeId`, `WorkItem.goalId`) are composite keys to `(id, tenantId)`, each `ON DELETE SET NULL` on its own column, so the purge alone deletes a row and the database clears every link to it without touching `tenantId`. Prisma cannot declare the column list; the migrations do, and `tests/integration/goals.test.ts` reads it from the catalogue.

Both tables are tenant tables with the standard policies; `app_user` holds DELETE on them for the purge alone. The transition trigger does not watch `goalId`. `[tenantId, goalId, stateCategory]` backs the item's goal key, the `goalId` filter and a goal's direct items; the project path's progress count reads `WorkItem_progress_project_path` (below).

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
| `PUT /goals/:id/health`, `PUT /initiatives/:id/health` (3.2b) | `goals.manage` | `setGoalHealth`, `setInitiativeHealth` (a person only) |

Every write is audited in its transaction, naming changed fields and never the description: `GOAL_CREATED`, `GOAL_UPDATED`, `GOAL_MOVED`, `GOAL_ARCHIVED`, `GOAL_UNARCHIVED`, `GOAL_DELETED` (the group's ids and counts), `GOAL_RESTORED`, `GOAL_HEALTH_SET` (the old and new values), the same `INITIATIVE_*`, `PROJECT_UPDATED` naming `initiativeId`, `WORK_ITEM_GOAL_CHANGED`, a lead cleared on member removal (`GOAL_UPDATED` / `INITIATIVE_UPDATED`, `reason: 'member_removed'`), and `GOALS_PURGED`.

## Progress (3.2b)

Derived on every read, never stored, cached or computed by a job (decision 212), by the pure `src/app-layer/domain/progress.ts` (2.5b's milestone progress reads it too, unchanged):

- **`{ scope, done, started }`**: scope is every counted item not cancelled, done the Done ones, started the Started ones. Zero items is "No items", never complete and never 100 %.
- **An initiative** counts the live, visible, non-cancelled items, sub-items included, of its live projects, archived projects included (finished projects are usually archived); deleted projects and items are left out.
- **A goal** counts the same through every live initiative of the goal and of every live goal below it, **plus** every such item naming the goal or a live goal below it directly (decision 211), each item once. Two grouped reads do it: `WorkItemRepository.countsByProjects` (per project and category) and `countsByGoals` (per direct goal, project and category); `goalProgress` adds a direct row only when its project is not already on the goal's project path, so an item reached both ways is counted through its project and never again. A property test holds it to a naive per-item count.
- **The reads are fixed** whatever the number of goals or initiatives shown (`usecases/goal-progress.ts`): the live goal tree (at most 2,000 goals), their live initiatives, those initiatives' visible projects (at most 10,000; above either, 422 `GOAL_PROGRESS_TOO_LARGE`), the two counts and the workspace calendar. A goal or initiative reaching more than 1,000 projects shows no progress but the count (`tooManyProjects`), never a cut count.
- **"Late"**: a due date before today in the workspace calendar's zone (as 3.1, decision 191) with open items. On an initiative's projects table, a project is late when its own due date has passed with open items, and its late milestones are counted by 2.5b's rule.
- **The index.** `WorkItem_progress_project_path` on `("tenantId", "projectId", "stateCategory") WHERE "deletedAt" IS NULL AND "stateCategory" <> 'CANCELLED'`, partial and in SQL only (migration `20261216120000`; Prisma cannot declare the predicate). `countsByProjects` is raw SQL naming that literal, because Prisma binds an enum as a cast of a text parameter, which the planner cannot prove implies the predicate. A plain `[tenantId, projectId, stateCategory]` index, measured on the 10k seed, pulled the list sorted by key, the templates' open items and a purged project's read off their indexes (the last at 418 buffers against its 400); partial, no other read's predicate implies it, and every plan check keeps its index. Both counts are plan-checked (`counts: progress, the project path`, `…, the direct goal path`).
- The lists and both pages carry each row's progress and "late"; the Deleted views show none. 3.4's estimates may later weight progress by points; that is a later decision.

## Health (3.2b)

- `PUT /goals/:id/health` and `PUT /initiatives/:id/health` (`goals.manage`, `If-Match` optional), body `{ health: 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'COMPLETED' | null }`; `null` is "No health set".
- **A person only** (decision 214): an API key or an agent (`apiKeyId`), a job (`actorType` other than a user) and the workspace's system user are refused with the hash-chained `AUTHZ_DENIED` entry a `requirePermission` denial writes, then 403 `NOT_A_PERSON` (`setsHealthAsPerson` in `goal.policies.ts`; `goalAffordances().setHealth` asks the same). No proposal kind sets health.
- **Independent of the status** (decision 205): setting health changes nothing else, and no status, progress or "late" changes health. A Started goal with health Completed and a Completed one with health Off track are both stored and shown, always with the field's name ("Status: Started · Health: Completed").
- Recorded on the row (`health`, `healthSetAt`, `healthSetByUserId`) and audited `GOAL_HEALTH_SET` / `INITIATIVE_HEALTH_SET` with `fromHealth` and `toHealth`. Setting the value it already has records it again (a person confirming it). Archived: 409 `ARCHIVED`; deleted: 404.
- **The history** (decision 207: no written update) is those audit entries, newest first, the last 50 (`ActivityRepository.healthHistory`, `[tenantId, entityId, createdAt]`), on each page.

## The pages (3.2b)

- **Navigation** (decision 222). One sidebar entry, **Roadmap**, for a holder of `goals.view`, current on every page under `/roadmap`. Its pages are the Roadmap page (`/roadmap`, 3.2c, where the entry opens), Goals (`/roadmap/goals`) and Initiatives (`/roadmap/initiatives`), main pages with a tab bar between them (the Roadmap tab is current on `/roadmap` alone). A goal's page (`/roadmap/goals/<id>`) and an initiative's page (`/roadmap/initiatives/<id>`) are subpages falling back to Goals and Initiatives. The command palette lists Roadmap, Goals and Initiatives.
- **Goals**: the tree as indented rows (each under its nearest shown ancestor), with status, lead, due date, health, progress and "Late"; filters by status, health, lead and archived (the shared filter system, synced to the URL); a Deleted view with Restore; "Goal" for a holder of `goals.manage`.
- **Initiatives**: the same, with the goal each serves and a goal filter.
- **A goal's page**: the ancestors as a breadcrumb, status and health with their names, description, due date and lead, the health control and its history, progress, the child goals and initiatives with theirs, the count of items naming it directly (with a link to the Work items page filtered by the goal), "Add child goal" (refused past three levels, with the reason) and "Add initiative", Archive (Completed or Cancelled only) and Delete through the undo toast.
- **An initiative's page**, the roadmap's "portfolio page" (decision 221): its goal and the goal's ancestors as a breadcrumb, the health control and history, progress, and a projects table (project, team, due date, progress, "Late", late milestones, archived projects greyed). "Add project" links a visible project not already in it (`projects.edit`, through `PUT /projects/:id/initiative`; a project in another initiative moves); a holder of `projects.create` may create one through the one project dialog with the initiative chosen; removing a project goes through the undo toast. Its slice of the roadmap (3.2c, below) sits under the projects table, whose "Planned dates" column reads the same answer.
- Every write follows `goalAffordances` (and the page's `createProject`), asked on the server (`src/lib/server/goal-pages.server.ts`); components in `src/components/goals/`, whose deletes and project removal go through the undo toast (`use-goals.ts`, in `SITE_CONTRACTS`). Copy is `roadmap.*`, `goals.*` and `initiatives.*`.

## The roadmap (3.2c)

The roadmap is a page, not a model (ADR 0006's Roadmap row), and read-only: nothing on it writes, audits or stores (decisions 215 to 217).

### Bars, derived (decision 215)

- **A project's bar** is the span of its live, non-cancelled items' **stored** start and due dates, as the scheduling engine reads an item's dates (decision 185), on its team's working calendar: both dates, from the start to the due date; a due date alone, one working day ending on it (from the working day on or before it); a start date alone, one working day from it (to the working day on or after it); a start after the due date, as a due date alone. The rule is `plannedSpanOf` in `src/app-layer/domain/schedule/span.ts`, and the span of several is `spanOf`, the one summary rule the engine's own summaries are now computed with. Done items count by their stored dates, not their actual ones: the roadmap shows plans, labelled "Planned dates", and runs no forward or backward pass, no "today" rule and no relation.
- **An initiative's bar** is the span of its projects' bars, **archived projects included** (decision 212's reason: finished projects are usually archived); **a goal's**, grouped by goal, the span of its subtree's initiatives' projects and of the items naming it, or a goal below it, directly (decision 211). "No initiative" spans its projects; "No goal" its initiatives.
- **Nothing dated, no bar**: the row is in the "No dates" list beside the chart (its due date's diamond is still drawn).
- **Due dates are diamonds** (decision 210): a goal's, an initiative's, a project's and each dated milestone's. A goal's or initiative's due date is not an engine deadline (ADR 0010 §3 unchanged): a project finishing after its initiative's due date, or after the due date of that initiative's goal, is flagged (`finishesAfterInitiativeDue`, `finishesAfterGoalDue`), and the initiative or goal it passes is flagged too (`finishesAfterDue`); nothing else changes.
- **A project is late** when its due date has passed with open items, its latest open item is due after its due date, or one of its milestones is late (2.5b's rule, today in `NOTIFICATIONS_TZ`); a goal or an initiative when its due date has passed with open items. "Today" is the workspace calendar's (3.1, decision 191).

### The read

`GET /api/t/:slug/roadmap?goalId=&initiativeId=&teamId=&leadUserId=&health=&status=&archived=&groupBy=` (`requirePermission('goals.view')`; `getRoadmap` in `src/app-layer/usecases/roadmap.ts` also asks `projects.view`), seven statements whatever the size:

1. the tenant binding;
2. every live goal and initiative, archived ones included, in one statement (`GoalRepository.roadmapRecords`, never a description; at most 2,000 of each);
3. the visible, live projects in scope, archived ones included (`ProjectRepository.roadmapProjects`), at most **500**: read one past, and above it 422 `ROADMAP_TOO_LARGE` with the count (one more statement, on the refusal only), never a cut list;
4. their **dated** milestones (`MilestoneRepository.datedForProjects`; an undated milestone has no diamond and is never late), at most 2,000, refused the same way;
5. **one aggregate** over `WorkItem` (`WorkItemRepository.roadmapAggregate`): per project, milestone and category, the count and the four boundary dates `spanFromBounds` needs (the earliest start of an item whose start is its first day, the earliest due date of an item with no start or a start after its due date, the latest due date, the latest start of an item with no due date), so no item is loaded; grouped by goal, the same per direct goal, project and team (decision 211), in the same statement (`UNION ALL`). The project path names the literal `'CANCELLED'` of the partial `WorkItem_progress_project_path`; both paths carry `tenantId`, `deletedAt` and the visibility in their own `WHERE`;
6. and 7. the working calendars of the teams in view and their holidays (`resolveWorkingCalendars`).

No description, comment or custom-field value is read. The aggregate is plan-checked (`roadmap: the aggregate (every project, both paths)`), and the read's statements are counted (`roadmap: the whole workspace`, `roadmap: grouped by goal`, seven each); `docs/performance.md` has the numbers.

### Filters and grouping

- `initiativeId` (one id) shows that initiative; `goalId` (one id) the initiatives of that goal's live subtree; `leadUserId`, `health` (`none` for "No health set") and `status` select initiatives. Any of these hides "No initiative". A deleted or unknown goal or initiative is 404 (`GOAL_NOT_FOUND`, `INITIATIVE_NOT_FOUND`); an unknown status or health 400.
- `teamId` narrows the projects (and, grouped by goal, the direct items) to one team and leaves out the initiatives with none of its projects; a row's bar and progress then cover the projects shown.
- `archived=true` shows archived goals, initiatives and projects; without it they are left out (an archived project still counts towards its initiative), except the goal or initiative a filter names.
- A project whose initiative is deleted shows under "No initiative", as its ancestry shows no initiative.
- `groupBy=goal`: the goal tree, each goal holding its child goals and its initiatives, then "No goal" for initiatives serving no shown goal, then "No initiative". With no filter narrowing, every live goal in scope is shown; with one, the goals above what is shown.

### The page and the chart (decisions 203, 216, 217 and 222)

- **The Roadmap page** (`/t/<slug>/roadmap`, `RoadmapPageView`) is the Roadmap entry's landing page: the tab bar, the filters through the shared filter system (synced to the URL), and `RoadmapView`: "Chart / Table", the zoom (months or quarters, quarters by default) and "Group by: Initiative / Goal", each remembered per viewer in `localStorage` (a convenience; the page works without it). A viewer without `goals.view` or `projects.view` gets a 404.
- **The chart** is SVAR React Gantt 2.8.3 through 3.1's one adapter (`svar-adapter.tsx`, decision 216), with the roadmap's own row model `roadmap-model.ts` beside `timeline-model.ts`: records as plain tasks (never the widget's summary type, which would widen a bar to its diamonds), due dates as milestone tasks under their row, the grid's name, progress and health columns (`gridColumns`). Never editable: the widget is `readonly` and every changing action is refused, as on the timeline. Today is highlighted; non-working days are not shaded at month and quarter zoom.
- **A row opens the item timeline** (decision 217): a project its own page in the Timeline layout (`/projects/<KEY>?layout=timeline`), an initiative or a goal the Work items page in the Timeline layout filtered by `initiativeId` or `goalId` (decision 220's filters, which the timeline route already reads), where dates change through 3.1c's flow. `?layout=timeline` is a deep link `WorkItemsView` applies and remembers. "No initiative" and "No goal" open nothing.
- **The table** (decision 203's rule, applied again) shows goal, initiative, project, start, finish, due date, progress, health, the flags in words and "Open timeline", for the same rows as the chart.
- **An initiative's page** shows its slice: `RoadmapView` with the initiative fixed and archived projects shown, offered only with `projects.view` (`RoadmapAffordances.roadmap`, asked on the server); its projects table's "Planned dates" column reads the same answer.
- Copy is `roadmap.page.*`, `roadmap.view.*`, `roadmap.tabs.roadmap` and `initiatives.detail.*`.

## Later

3.4's estimates may weight progress by points; 7.4's digests may explain a goal's state; 8.4's public read-only links for roadmaps.
