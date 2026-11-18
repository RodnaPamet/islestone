# kaneo study

Read-only study for Islestone, 2026-11-18. Nothing in the clone was run, installed or built; every fact below was read from files at the pinned commit. Algorithms are restated in prose and pseudo-code, not copied.

## 1. Pin and licence facts

| Fact | Value | How it was checked |
|---|---|---|
| Repository | `https://github.com/usekaneo/kaneo` | `git remote -v` in the clone |
| Pinned commit | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` (2026-11-18, "Merge pull request #2237 from FUSE-Studio/fix/pnpm-dev-fresh-clone") | `git log -1` |
| History | full clone (not shallow), 4,202 commits, first commit `3b8654f8` on 2024-12-30 | `git rev-parse --is-shallow-repository`, `git log` |
| Root licence | **MIT**, "Copyright (c) 2024 Andrej Acevski" (`LICENSE`, 21 lines) | read |
| Licence history | `LICENSE` added in `c97fffcf` on 2025-01-16 and never changed since; the text at that commit is the same MIT text | `git log -- LICENSE`, `git show c97fffcf:LICENSE` |
| README | badge and section "MIT License - see LICENSE" (`README.md` lines 9, 72–74) | read |
| Sub-package licences | `packages/importers`, `packages/mcp`, `packages/planka-import`: MIT, "Copyright (c) 2026 Kaneo MCP contributors". `packages/cli`: MIT, "Copyright (c) 2026 Kaneo contributors". `apps/docs`: MIT, "Copyright (c) 2023 Mintlify" (docs template). `scripts/slop-labeler/vendor`: ISC, "Copyright (c) 2026 kqr" | read each `LICENSE` |
| `package.json` licence fields | `"MIT"` in `packages/{cli,editor,importers,libs,mcp,permissions,planka-import,typescript-config}/package.json`. **No `license` field** in `packages/email`, the root, `apps/{api,web,mobile,site}`, `scripts/{slop-labeler,ui-review-bot}` or `tests/e2e` package files; all of those are `"private": true` and the root `LICENSE` governs them. Of the `packages/*`, only `cli`, `mcp`, `importers` and `planka-import` carry a `LICENSE` file of their own | every tracked `package.json` parsed (corrected in the licence check below) |
| NOTICE file | none | `ls` |
| SPDX headers | none found in tracked files | grep |
| Open-core folders | none: no tracked path matches `ee/`, `enterprise` or `commercial` | `git ls-files` grep |
| Restricted directories (given) | `[]`; none found either | — |

Notes and limits:

- The 17 days before `LICENSE` existed (2024-12-30 to 2025-01-16) are irrelevant to Islestone: every file read here is distributed at HEAD under the root MIT licence. Recorded only because H0 asks for licence history.
- MIT grants no trademark rights. Islestone must not use the name "Kaneo" or its logo in product, marketing or UI.
- `packages/importers/src/plane/*` is Kaneo's own importer that calls Plane's HTTP API. A grep found no AGPL marker or Plane copyright in it, but it was **not audited line by line**. Plane is "inspiration only" in roadmap 2.2; read that folder for structure only, and re-check before translating any of it.
- Runtime dependency licences (better-auth 1.7.14, drizzle-orm ^0.45.4, hono ^4.13.14, octokit ^5.0.5, @octokit/webhooks ^14.2.0, date-fns ^4.4.0, @date-fns/tz ^1.5.0, @dnd-kit/*) were read as version ranges from `apps/api/package.json` and `apps/web/package.json`; their licences were **not verified** here. Islestone takes none of them by porting; any it adopts goes through the 0.3 allowlist on its own.

## 2. Where the relevant code lives

All paths are relative to the repository root. Line counts are `wc -l` at the pinned commit, tests excluded unless stated.

### Schema

| Path | Lines | Content |
|---|---|---|
| `apps/api/src/database/schema.ts` | 1,662 | Every Drizzle table (one file) |
| `apps/api/src/database/relations.ts` | 421 | Drizzle relation declarations |
| `apps/api/auth-schema.ts` | 281 | better-auth generated tables (user, session, account, organization plugin) |
| `apps/api/drizzle/0000…0073*.sql` | 74 migrations | Generated SQL; several are hand-written repairs (`0043_backfill_time_entry_durations`, `0046_repair_task_number_counters`, `0062_*` UTC defaults) |

### Worth porting, by topic (translate, do not copy)

| Topic | Paths (lines) | Islestone target |
|---|---|---|
| Key allocation and lookup | `task/controllers/claim-task-numbers.ts` (34), `task/controllers/get-task-by-ticket-id.ts` (112), `project/project-key.ts` (40), `task/ticket-id.ts` (1), `drizzle/0046_repair_task_number_counters.sql` | 2.1 keys; ADR 0002 §4 |
| Board ordering | `task/controllers/next-task-position.ts` (59), `task/controllers/reorder-tasks.ts` (155) | 2.3 board; ADR 0002 §5 (idea only) |
| Cross-project move | `task/controllers/move-task.ts` (245) | 2.2 move usecase; ADR 0002 §10 "Moves" |
| Row lock helper | `task/controllers/with-locked-task.ts` (23) | 2.2 repository pattern |
| States (columns) | `column/` (486, plus a 14-line test), `project/controllers/insert-project.ts` (110, default columns), `task/task-is-completed.ts` (10), `task/validate-task-fields.ts` (293, valid statuses and virtual statuses) | 2.1 `WorkflowState`; ADR 0002 §3 |
| Relations and sub-items | `task-relation/` (646), `task/is-subtask.ts` (9), `task/get-subtask-counts.ts` (45), `task/get-subtask-parent-projects.ts` (47) | 2.1 relations; ADR 0002 §2, §6 |
| Labels | `label/` (1,092), incl. `label/deletion-lock.ts` (83) and `drizzle/0048_resumable_label_deletion.sql` | 2.1 labels (rules only, not the model) |
| Custom fields | `custom-field/` (1,469): `assert-valid-definition.ts` (126), `choice-options.ts` (83), `plan-choice-value-changes.ts` (54), `resolve-field-update.ts` (134), `fill-default-values.ts` (52), `controllers/set-custom-field-value.ts` (180); plus `task/validate-task-fields.ts` | 2.4; ADR 0002 §7 |
| Time entries | `time-entry/` (399): `duration.ts` (26), `schema.ts` (48), controllers (148) | 3.4 |
| Recurrence | `task/recurrence/` (237 + 126-line test): `schema.ts` (56), `next-occurrence-date.ts` (56), `create-next-occurrence.ts` (79), `subscribe.ts` (45); handoff in `task/controllers/duplicate-task.ts` (483, lines 134–170 and 331–365) | 2.5 recurring items |
| Workflow rules | `workflow-rule/` (284), `plugins/github/utils/resolve-column.ts` (51), `migrations/column-migration.ts` (185, default rules) | 5.1 automation; 5.3 |
| GitHub binding | `github-integration/` (2,409, plus 203 lines of tests): `controllers/verify-repository-owner.ts` (75), `controllers/verify-github-installation.ts` (185), `controllers/create-github-integration.ts` (131), `index.ts` (432, webhook route at 402–432) | 5.3 |
| GitHub webhooks | `plugins/github/webhook-handler.ts` (239), `plugins/github/webhooks/*` (10 files, 1,678) | 5.3 |
| Key matching in branches and PRs | `plugins/github/utils/branch-matcher.ts` (140), `plugins/github/utils/issue-references.ts` (53), `plugins/github/services/resolve-pull-request-task.ts` (79) | 5.3 "link by key" |
| Two-way issue sync | `plugins/sync/*` (1,737, plus 139 lines of tests), `plugins/github/utils/sync-echo.ts` (220), `plugins/github/utils/inbound-echo.ts` (249), `plugins/github/services/deferred-issue-edits.ts` (468), `plugins/github/services/sync-latest-task-value.ts` (248), `plugins/github/events/*` (6 files, 682) | 5.3 (later), 5.5 |
| Resumable GitHub import | `github-integration/import-state.ts` (48), `import-pages.ts` (148), `import-lock.ts` (83), `controllers/import-issues.ts` (695) | 5.5 importers |
| Leases and locks | `plugins/sync/lease.ts` (52), `scheduler/leader-lock.ts` (43), `plugins/github/services/integration-task-scope.ts` (131) | 1.6 jobs, 5.x |
| Normalised importer model | `packages/importers/src/types.ts` (94), `keys.ts`; Jira/Linear/Trello/Planka sources (6,617 lines total incl. tests) | 5.5 (structure) |
| Permission statements | `packages/permissions/src/index.ts` (104) | 1.4 (reference only) |

Sibling providers with the same shape, for GitLab in 5.3: `plugins/gitlab/*`, `plugins/gitea/*`, `gitlab-integration/`, `gitea-integration/`.

## 3. Data model (transcribed compactly)

Conventions in Kaneo: ids are text cuid2 (`createId()`); timestamps are `timestamp without time zone` holding UTC, defaulting to `(now() AT TIME ZONE 'utc')` (schema.ts lines 22–25); most enum-like columns are free `text` validated in code; almost every FK is `ON DELETE CASCADE ON UPDATE CASCADE`. **There is no row-level security and no `tenantId` on child tables**: tenancy is reached by joining up to `project.workspace_id`. Line numbers are in `apps/api/src/database/schema.ts`.

```
workspace (309)            id, name, slug UNIQUE, logo, metadata, description, created_at, archived_at, archived_by→user SET NULL
workspace_member (327)     id, workspace_id→workspace, user_id→user, role text default 'member', joined_at
                           idx(workspace_id), idx(user_id)            -- no unique(workspace_id,user_id) in schema.ts
workspace_role (472)       id, workspace_id→workspace, role text, permission text   -- one row per (role, permission)
workspace_member_access (540)  id, workspace_id, user_id, project_access text default 'all'; unique(workspace_id,user_id)
workspace_member_project (570) id, workspace_id, user_id, project_id; FK (workspace_id,project_id)→project(workspace_id,id)
team (403)                 id, name, member_count, workspace_id→workspace     -- better-auth teams, not workflow owners
team_member (420)          id, team_id→team, user_id→user, membership_key UNIQUE

project (500)              id, workspace_id→workspace, slug (the key prefix, e.g. "ISL"), icon, name, description,
                           is_public, include_subtasks bool default true, archived_at,
                           last_task_number int default 0           -- the key counter
                           position int, background_* (3 cols)
                           unique(workspace_id, id)  idx(workspace_id, position)
                           -- no DB unique on (workspace_id, slug): enforced in code (project/project-key.ts)
column (601)               id, project_id→project, name, slug, position int, icon, color, is_final bool
                           idx(project_id)                          -- a workflow state; no category beyond is_final
task (686)                 id, project_id→project, position int default 0, number int default 1,
                           assignee_id→user SET NULL, title, description,
                           status text default 'to-do'               -- column slug, or virtual 'planned' | 'archived'
                           column_id→column SET NULL,
                           priority text default 'low'               -- 'no-priority'|'low'|'medium'|'high'|'urgent'
                           start_date, due_date, recurrence jsonb (TaskRecurrence), created_at, updated_at
                           unique(project_id, number); idx project, assignee, column, due_date;
                           partial idx(project_id,id) WHERE start_date or due_date not null
task_relation (1353)       id, source_task_id→task, target_task_id→task, relation_type text, created_at
                           relation_type ∈ {'subtask','blocks','related'} (Zod, task-relation/schema.ts)
                           idx(source), idx(target)                 -- no unique, no CHECK; subtask = source is parent
label (942)                id, name, color, deletion_started_at, task_id→task (nullable), workspace_id→workspace (nullable)
                           task_id NULL  ⇒ workspace label definition; unique(workspace_id,name) WHERE task_id IS NULL
                           task_id set   ⇒ a per-task copy of the label; unique(task_id, name)
custom_field_definition (1577)  id, project_id→project, name, type text ∈ {text,number,date,dropdown,boolean,multiselect},
                           required bool, default_value text, options jsonb (string[]), hidden_options jsonb string[] default [],
                           position int
custom_field_value (1611)  id, task_id→task, field_id→custom_field_definition, value text
                           unique(task_id, field_id)                -- multiselect value = JSON array string
time_entry (811)           id, task_id→task, user_id→user SET NULL, description, start_time NOT NULL, end_time (NULL = running),
                           duration int seconds (NULL while running)
activity (845)             id, task_id→task, type text, user_id→user SET NULL, content, event_data jsonb,
                           external_user_name/avatar/source/url; unique(task_id, external_source, external_url)
comment (1320)             id, task_id→task, user_id→user CASCADE, content, created_at, updated_at
workflow_rule (630)        id, project_id→project, integration_type text ('github'|'gitea'|'gitlab'),
                           event_type text ∈ {branch_push, pr_opened, pr_merged, issue_opened, issue_closed, issue_reopened},
                           column_id→column                          -- no unique(project_id, integration_type, event_type)
integration (1190)         id, project_id→project, type text, config text (JSON), is_active; unique(project_id, type)
external_link (1275)       id, task_id→task, integration_id→integration (nullable = manual link),
                           resource_type text ('issue'|'pull_request'|'branch'|manual kinds), external_id, url, title,
                           metadata text (JSON: sync stamps, PR state, last commit, deferred edit)
github_import (1220)       integration_id PK→integration, run_id, state jsonb (GitHubImportState), updated_at
import_run (1237)          id, workspace_id, user_id, source, status, include_comments, message, projects jsonb, error,
                           heartbeat_at, created_at, finished_at
job_lease (775)            name PK, owner, expires_at              -- lease rows for leader election and sync locks
calendar_feed (664)        id, project_id, token UNIQUE, label_ids jsonb, time_zone
github_integration (1168)  legacy, dropped at startup; ignore
```

GitHub integration `config` JSON (`plugins/github/config.ts`, 96 lines): `repositoryOwner`, `repositoryName`, `installationId`, `repositoryId`, `verifiedGithubAccountId`, `verifiedByUserId`, `syncRules {outgoing, incoming}`, `branchPattern` (one of eight templates or custom), `customBranchRegex`, `commentTaskLinkOnGitHubIssue`, `statusTransitions {onBranchPush, onPROpen, onPRMerge}` (defaults `in-progress`, `in-review`, `done`).

Recurrence JSON (`task/recurrence/schema.ts`): `frequency` ∈ daily|weekly|monthly|yearly, `interval` 1..99, `weekdays` (0=Sunday..6, unique, weekly only), `timeZone` (IANA, validated by constructing an `Intl.DateTimeFormat`).

Permission statements (`packages/permissions/src/index.ts`, better-auth access control): resources `project` (create, read, update, delete, share), `task` (create, read, update, delete, assign), `label` (create, read, update, delete), `workspace` (read, update, delete, manage_settings); roles viewer, member, admin, owner.

## 4. Algorithms

### 4.1 Key allocation (`claim-task-numbers.ts`)

```
claim(projectId, n, tx):
  UPDATE project SET last_task_number = last_task_number + n WHERE id = projectId RETURNING last_task_number
  if no row: 404
  return returned - n + 1          -- first of n consecutive numbers; the row lock serialises creators
```

Kaneo stores the counter on `project` itself, so the same row lock also serialises position allocation (4.3). Migration `0046` raised stale counters to `max(number)` after imports had written numbers without advancing the counter: the importer rule ADR 0002 §4 already states ("raise the sequence to at least the highest imported number").

**Lookup by key** (`get-task-by-ticket-id.ts`): NFKC-normalise the input, split with `^(.+)-(\d+)$`, bound the number to int32, filter candidate tasks by `number` and a case-insensitive slug match (`isSameProjectKey`: NFKC + lower-case on both sides), restricted to workspaces the caller may read and projects the caller can access; rank archived projects below live ones; two equal-ranked survivors → 409 "matches multiple accessible tasks".

**Move to another project** renumbers the item in the destination and keeps no alias (4.6).

### 4.2 Workflow states (`column/`, `task-is-completed.ts`, `validate-task-fields.ts`)

- New projects get four columns: To Do, In Progress, In Review (not final), Done (final).
- A task's `status` is a column slug, or one of two virtual statuses with no column: `planned` and `archived`. Unknown statuses from imports coerce to `planned` with a warning.
- "Completed" is `exists(column where column.project = task.project and column.slug = task.status and is_final)`: completion belongs to the task's own project's workflow even when its parent is elsewhere.
- Delete column: lock the column row `FOR UPDATE`, count tasks in it, 409 if any; this is ADR 0002 §3's "a state with items cannot be deleted", with the lock taken before the count so a concurrent insert cannot slip past.

### 4.3 Board ordering (`next-task-position.ts`, `reorder-tasks.ts`)

```
nextPosition(tx, project, column):        -- caller already holds the project row lock
  (max, total) = max(position), count(*) over tasks in that column
  if max < INT_MAX-1: return max + 1
  if total >= INT_MAX-1: 409 "column full"
  renumber the column 1..total by (position, created_at, id) in one UPDATE … FROM (row_number() …)
  return total + 1

reorder(project, moves[{id, position, status?}], expected[{id, position, status}]?):
  refuse duplicate ids; validate positions and target statuses
  BEGIN
    lock project row FOR UPDATE                    -- same lock creates/moves take
    lock affected tasks FOR UPDATE ordered by id    -- deadlock-free order
    if expected given and the locked rows differ from it in count, status or position: 409 "Board changed; refresh"
    one UPDATE … FROM jsonb_to_recordset(moves)     -- one bind parameter, so big boards fit Postgres' limit
    if rows updated ≠ moves: 409 "Task changed projects; retry"
  COMMIT; publish per-task status events, then one "tasks.reordered"
```

Islestone keeps fractional `sortKey` (ADR 0002 §5) and does not take integer positions. Worth taking: (a) the client sends the snapshot it rendered and the server refuses with 409 when the locked rows differ; (b) locks in a fixed order; (c) the batched update through one JSON parameter for bulk moves (2.2 bulk update).

### 4.4 Relations and sub-items (`task-relation/controllers/create-task-relation.ts`)

```
create(source, target, type, user, workspace):
  if source = target: 400
  BEGIN
    lock both tasks' projects FOR SHARE, ordered by id     -- serialises with project moves
    load source and target, each joined to a project of `workspace`, else 404
    assert user can access target's project
    if a relation of this type exists between them in either direction: 409
    insert
  COMMIT; publish "task-relation.created"
```

- A sub-item is a `subtask` relation with the parent as source. Nothing limits a child to one parent, and the child may sit in another project.
- There is **no cycle check** for `blocks` or `subtask` beyond the 2-cycle the either-direction duplicate check refuses (A→B then B→A). A→B→C→A is accepted.
- Sub-item progress for a page of tasks is one grouped query: per parent, `count(distinct child)` and `count(distinct child) filter (where completed)`, restricted to the workspace and the caller's project access.

Islestone takes the self-relation 400, the either-direction duplicate 409 (for `RELATES`, ADR 0002 stores `fromId < toId` instead), the workspace check on both ends, and the grouped progress query. It does not take the sub-item-as-relation model (see §6).

### 4.5 Labels (`label/controllers/assign-label-to-task.ts`)

A workspace label is a row with `task_id NULL`. Assigning it creates a **copy** of the row with `task_id` set (insert … on conflict (task_id, name) do nothing); the label's identity on a task is its name. Deletion is resumable: `deletion_started_at` is stamped first, assignment refuses a label being deleted (409), and the cascade proceeds in batches (`label/deletion-lock.ts`, migration `0048`). Islestone keeps `Label` + `WorkItemLabel` (ADR 0002 §12) and takes only the "being deleted → 409" rule and batched cascade idea.

### 4.6 Move to another project (`move-task.ts`)

```
move(task, destProject, requestedStatus?, user):
  refuse same project (400); dest must be in source's workspace; user needs access to dest
  destColumn = requestedStatus's column (400 if invalid) ?? column with the same slug ?? first column (400 if none)
  BEGIN
    lock source and dest project rows FOR KEY SHARE in sorted-id order; 409 if either left the workspace
    number = claim(dest, 1); position = nextPosition(dest, destColumn)
    UPDATE task SET project, status, column, number, position WHERE id AND project = source   -- 409 if 0 rows
    if assignee has no access to dest: clear assignee, write an "unassigned" activity
    delete the task's integration links whose integration is not on dest
    move the task's assets to dest
  COMMIT; publish "task.moved"
```

ADR 0002 §10 maps the state by **category** (Kaneo maps by slug) and keeps the old key in `WorkItemKeyAlias` (Kaneo drops it). Take: sorted lock order, conditional update on the old project, unassign-on-lost-access (ADR 0003 §1 equivalent), dropping integration links that do not exist in the destination.

### 4.7 Custom fields (`custom-field/*`)

Definition rules (`assertValidDefinition`):

- `required` needs a non-blank default.
- number default matches `-?\d+(\.\d+)?(e[+-]?\d+)?` and is finite; boolean default is `true`/`false`; date default passes the date validator; dropdown default is one of the options.
- dropdown has ≥ 1 option; multiselect ≥ 2 distinct non-blank options; a multiselect default is a JSON array of options.
- hidden options must be options of the field, only choice fields have them, and the default cannot be hidden.

Update planning (`resolveFieldUpdate`, `planChoiceValueChanges`):

```
type change: allowed only dropdown ↔ multiselect; anything else 400
options: normalised (trim, drop blank, dedupe); removed = old − new
if any task value uses a removed option: 400 "pick another option or hide it"
dropdown → multiselect: value "A" becomes ["A"]
multiselect → dropdown: one pick → that pick; zero → empty; >1 on any task → 400
default converts the same way; hidden options default to the old hidden set ∩ new options
```

Hidden options: still valid on tasks that already hold them, but cannot be newly picked (`findNewHiddenPicks` compares the next value with the current one).

Mapping to Islestone (ADR 0002 §7): keep every rule above; store values typed in `CustomFieldValue` instead of Kaneo's single `value text` (which ADR 0002 rejects for filtering, foreign keys and concurrency). A hidden option is `CustomFieldOption.archivedAt`; "removing a used option is refused" becomes the FK `RESTRICT` plus the same 400 message. Kaneo's types `dropdown`/`boolean`/`multiselect` map to `SELECT`/`CHECKBOX`/`MULTI_SELECT`; Kaneo has no `PERSON` or `URL`.

### 4.8 Time entries (`time-entry/*`)

- Start time required; end time optional (open entry = running timer; duration NULL).
- Duration is derived on the server, in whole seconds, from end − start; start after end is 400; more than int32 seconds is 400. Migration `0043` back-filled durations and nulled them on running entries.
- Timestamp validation: an ISO 8601 pattern with offset, then `Date.parse`, then a UTC year/month/day round-trip so impossible dates such as 2024-02-31 are refused.
- Not found: a rule of one running timer per user, approval, rates or timesheets. Roadmap 3.4 builds those; take the derivation and validation only.

### 4.9 Recurrence (`task/recurrence/*`, `duplicate-task.ts`)

```
nextOccurrenceDate(date, rule):          -- computed in rule.timeZone so local midnight stays local midnight across DST
  z = date viewed in rule.timeZone
  if weekly and weekdays given:
    days = weekdays shifted to Monday-first, sorted; today = z's Monday-first index
    if some day > today: return z + (day − today) days
    else: return z + interval weeks + (days[0] − today) days
  else: add `interval` of the frequency (month ends clamp: Jan 31 + 1 month = Feb 28; next step starts from the clamp)

nextOccurrenceDates(task, rule, completedAt):
  due = nextOccurrenceDate(task.due ?? completedAt, rule)
  if task has both start and due: start = task.start + (calendar days between new due and old due, in the zone)
  else start = null

trigger: task.status_changed, task.moved, task.updated, and column.finality_changed (to final)
createNextOccurrence(task):  up to 3 attempts if the task changed project meanwhile
  if task has a rule and is completed and its project has an open column:
    duplicate it into the first open column, unassigned if the assignee left,
    inside the copy's transaction CLAIM the rule: UPDATE source SET recurrence = NULL WHERE id AND recurrence IS NOT NULL RETURNING recurrence
    no row claimed → roll back the copy (another completion already continued the series)
```

The claim is what makes the trigger idempotent across the four events: the rule moves to the new item exactly once. Roadmap 2.5 recurring items can take the date algorithm and the claim; Islestone's trigger is "moved into a `DONE` category state" and the job runs on BullMQ (1.6), not an in-process event.

### 4.10 Workflow rules (`workflow-rule/*`, `resolve-column.ts`)

```
upsertRule(project, provider, event, column):
  column must belong to project (400)
  find rule by (project, provider, event); update its column, else insert     -- no unique index: two concurrent upserts can both insert

resolveTargetStatus(project, event, fallbackSlug):
  columns = project's columns by position; none → fallbackSlug
  rule = rule for (project, 'github', event); if its column still exists → that slug
  else column with slug = fallbackSlug (from config.statusTransitions) → that slug
  else first column
```

Default rules created by `migrations/column-migration.ts`: `issue_opened → to-do`, `issue_closed → done`, plus whatever `statusTransitions` named.

Islestone mapping (vocabulary ADR 0006: "Automation rule", never "workflow rule"): each Kaneo rule is an `AutomationRule` with trigger = integration event, condition = linked item, action = "set state". Roadmap 5.1 builds the general engine; 5.3 should seed the six provider events as triggers and store the target as a `WorkflowState` id, falling back by **category** (`STARTED` for push/PR open, `DONE` for merge) rather than by slug. Add the unique index Kaneo lacks.

### 4.11 GitHub integration

**Binding verification** (`verify-repository-owner.ts`). Prevents a user from binding a repository they do not administer:

```
account = the caller's GitHub account from completed OAuth (never from the request); 403 if missing
installation = app.getRepoInstallation(owner, repo)
octo = installation client
user = users.getById(account.accountId); refuse if ids differ
permission = repos.getCollaboratorPermissionLevel(owner, repo, user.login); require 'admin'
repo = repos.get(owner, repo)
store {installationId, repositoryId, canonical owner/name, verifiedGithubAccountId, verifiedByUserId}
any failure → one generic 403 (do not reveal whether the repo or installation exists)
```

Outbound writes get their client from `getVerifiedInstallationOctokit` (`plugins/github/utils/github-app.ts` line 121), which refuses unless `hasVerifiedGitHubBinding(config)` holds (positive safe integers for installation and repository id, a numeric account id, a verifier). Legacy bindings without these fields must be re-verified.

**Webhook intake** (`github-integration/index.ts` 402–432, `webhook-handler.ts`): read the raw body, require `x-hub-signature-256` and `x-github-event`, verify and dispatch through `@octokit/webhooks`. Handled: `issues.{opened, closed, reopened, labeled, unlabeled, edited}`, `push`, `pull_request.{opened, reopened, closed}`, `label.created`, `issue_comment.created`. There is **no stored delivery-id dedupe**; handlers are idempotent by checking for an existing link before creating one. H5 requires replay rejection, so Islestone adds a delivery-id table.

**Key extraction** (`branch-matcher.ts`, `issue-references.ts`, `resolve-pull-request-task.ts`):

```
branch templates: {slug}-{number}, {slug}-{number}-{title}, {number}, {number}-{title}, feature/…, fix/…
branchRegex(template, slug) = escape(template) with {slug}→slug, {number}→(\d+), {title}→([a-z0-9-]*), anchored, case-insensitive,
                              optional trailing "-anything"
explicitKey(text, slug) = first "<slug>-<n>" not inside a word (task URLs "/task/<KEY-N>" count as the key), else "task[:#- ]n"
issueRefs(title, body, repoUrl) = "#n", "owner/repo#n" or an issue URL of THIS repo; in the title anywhere,
                                  in the body only after close/closes/closed/fix/fixes/fixed/resolve/resolves/resolved

resolvePRItem(project, pr):
  n = branchRegex match ?? explicitKey(pr.title) ?? explicitKey(pr.body)
  if n and an item with that number exists in project → it
  else items linked to the referenced issues: exactly one → it; two or more → none
  else an item whose URL appears in the PR text
```

**Event → state** (`webhooks/push.ts`, `pull-request-opened.ts`, `pull-request-closed.ts`):

```
push: ignore deletions (after = 000…), non-branch refs, and main/master/develop/staging/production
      for each integration on the repo: n from the branch; item found → upsert a branch link with the head commit;
      target = resolveTargetStatus(branch_push, 'in-progress');
      move only if the item is not already there and (the link is new or the item is not in a final state); stop at first match
pr opened/reopened: collect candidate (integration, item) pairs over every integration on the repo;
      act only if exactly one; re-resolve inside the transaction and refuse if it changed; create the PR link;
      move to resolveTargetStatus(pr_opened, 'in-review')
pr closed: update the link's metadata (closed, merged, mergedAt);
      if merged and no OTHER PR linked to the item is still open → move to resolveTargetStatus(pr_merged, 'done')
```

Side effects run after commit: each handler collects `afterCommit` callbacks inside the transaction and runs them once it commits (`integration-task-scope.ts`), so no event announces a write that rolled back. Islestone's automation bus should enqueue its jobs the same way (outbox in the transaction, publish after).

**Two-way issue sync** (`plugins/sync/*`, `sync-echo.ts`, `inbound-echo.ts`, `deferred-issue-edits.ts`). Kept for a later 5.3 iteration; the roadmap asks only for linking and state moves.

- Status and priority are mirrored as issue labels `status:<slug>` and `priority:<value>`; issue close/reopen follows entering or leaving a final column (archived keeps the issue's state).
- Filters: `syncRules.incoming` (repository label names, any/all) decides which issues are imported; `syncRules.outgoing` (workspace label ids) decides which items sync out, and an item that stops matching has its links marked `syncFilterPaused`.
- Echo suppression: per link and field, a stamp records outbound intents as `{sha256(value), timestamp, provider updated_at, pending/cancelled/uncertain}`, at most 32 settled entries; a pending intent older than 5 minutes becomes uncertain. An inbound webhook whose value hash matches a recent outbound intent (same provider `updated_at` when known, else within 5 minutes) is an echo and ignored; if the stored value differs, the provider is re-read to confirm before ignoring.
- Before closing or reopening, the issue's current state is read; if it is already the target, nothing is written (a second close would turn "not planned" into "completed").
- Edits that cannot be sent (provider errors, rate limits) are recorded on the link as a deferred edit `{id, fields, scope}`, where `scope` is a SHA-256 of the repository identity, and a scheduled job replays them under a lease. A rebound repository therefore never receives a stale edit.

**Resumable import** (`import-state.ts`, `import-pages.ts`, `import-issues.ts`): a state machine `issues → (per issue: labels → comments) → pulls → complete` persisted in `github_import.state` with a `runId`; each HTTP request processes at most 4 GraphQL pages and returns 202 while pending; every page is Zod-validated with size caps (title 4,096, body 1,000,000, 1 issue per page, 25 labels, 20 comments, 10 PRs) and a cursor that does not advance is an error; the `repositoryId` in each page must match the state's; at most 2 imports in flight. Roadmap 5.5 wants this shape as BullMQ jobs: checkpoint after each page, idempotent re-run keyed on source ids, dry-run counts.

**Leases** (`plugins/sync/lease.ts`): `INSERT INTO job_lease … ON CONFLICT (name) DO UPDATE … WHERE expires_at < now() RETURNING` claims a 15-minute lease; renew every 60 s while owned; delete on finish; wait with exponential backoff up to 5 s. Usable in Islestone for per-item sync serialisation where a transaction-scoped advisory lock cannot span provider calls.

**Revision token** (`integrationTaskRevision`): reads `xmin::text` of the task row to detect a concurrent change between a read and a provider round trip. Islestone has `WorkItem.version` (ADR 0002 §9) and should use that instead of `xmin`, which changes on any write including `sortKey` and is not stable across a dump and restore.

## 5. Mapping onto Islestone

| Kaneo | Islestone | Sub-phase / ADR | Take |
|---|---|---|---|
| `workspace` | `Tenant` (Workspace), column `tenantId` | 1.3; ADR 0006 | Nothing; Islestone ports its own tenancy with RLS |
| `workspace_member` + `workspace_role` + `packages/permissions` | `TenantMembership`, `PermissionSet` | 1.4; ADR 0004 | Reference: Kaneo runs on better-auth 1.7.14 (organization and access-control plugins), useful evidence for ADR 0004's later Better Auth criteria |
| `team` | `Team` (owns workflow) | 2.1 | No: Kaneo's team is a membership group, not a workflow owner |
| `project.slug`, `last_task_number` | `Project.keyPrefix`, `ProjectKeySequence`, `ProjectKeyPrefix`, `WorkItemKeyAlias` | 2.1; ADR 0002 §4 | Atomic increment, batch claim, NFKC case-insensitive key match, ambiguity 409, import counter repair |
| `column` (`slug`, `is_final`) | `WorkflowState` (per team, category) | 2.1; ADR 0002 §3 | Default set as seed names; delete-with-items 409 with lock-then-count; `is_final` splits into `DONE`/`CANCELLED` |
| virtual `planned` / `archived` | `BACKLOG` state; `archivedAt` | 2.1 | No virtual statuses: every item has a real state |
| `task` | `WorkItem` | 2.1, 2.2; ADR 0002 | Field set (title, description, priority incl. "no priority", start/due, assignee); not `status` as text |
| `task.position` int | `WorkItem.sortKey` fractional | 2.3; ADR 0002 §5 | Expected-snapshot 409, sorted lock order, batched JSON update |
| `task_relation` `blocks` / `related` | `WorkItemRelation` `BLOCKS` / `RELATES` | 2.1; ADR 0002 §6 | Self 400, duplicate 409, same-workspace check; add the cycle refusal Kaneo lacks |
| `task_relation` `subtask` | `WorkItem.parentId` | 2.1; ADR 0002 §2 | Grouped progress query only |
| `label` (+ per-task copies) | `Label`, `WorkItemLabel` | 2.1 | "Being deleted" 409 and batched cascade only |
| `custom_field_definition` / `_value` | `CustomField`, `CustomFieldOption`, `CustomFieldValue` typed | 2.4; ADR 0002 §7 | All definition and change rules (§4.7); not the text value column |
| `comment`, `activity` | `Comment` (encrypted body), activity from the audit trail | 2.2; ADR 0002 §11 | `activity`'s external-actor columns and its unique `(task, source, url)` dedupe for integration-sourced entries |
| `time_entry` | `TimeEntry` | 3.4 | Running timer as null end, server-derived duration, timestamp validation |
| `task.recurrence` | recurring item rule | 2.5 | Rule schema, zoned next-date algorithm, start shift, rule claim |
| `workflow_rule` | `AutomationRule` (trigger = provider event, action = set state) | 5.1, 5.3; ADR 0006 | Six provider events, resolve-with-fallback; add a unique index; fall back by category |
| `integration` + config JSON | per-workspace installation + per-project repository binding | 5.3 | Binding verification flow, `hasVerifiedGitHubBinding`; secrets through field encryption |
| `external_link` | `WorkItemLink` (`PULL_REQUEST`, `COMMIT`, …) | 2.2, 5.3; ADR 0002 §12 | Resource kinds, metadata for PR state and head commit; drop links of integrations not on the destination project on move |
| GitHub handlers, key extraction | 5.3 "link by key, move state on PR events" | 5.3; ADR 0002 §4 (old keys via `WorkItemKeyAlias`) | §4.11 algorithms; key extraction must also resolve retired prefixes |
| `github_import`, `import_run`, `packages/importers/src/types.ts` | importer jobs | 5.5 | Phase state machine, page caps, non-advancing cursor refusal, normalised intermediate model (project, columns, labels, items, relations, comments, warnings) |
| `job_lease` | lease table or BullMQ locks | 1.6 | The conditional-upsert lease |
| in-process `publishEvent` | automation bus + outbox | 1.6, 5.1; ADR 0005 | The after-commit rule only |

## 6. What Islestone must not take

No copyleft or source-available code was found at this commit: every licence file is MIT or ISC, and there are no restricted or `ee/` directories. So nothing is barred on licence grounds. What follows is barred because it conflicts with Islestone's ADRs, its security baseline or another rule.

- **Licence and brand.** The name "Kaneo" and its marks (MIT grants no trademark). `scripts/slop-labeler/vendor` (ISC, a different author) and `apps/docs` (Mintlify template) are irrelevant and must not be pulled in by a broad copy. `packages/importers/src/plane/*`: structure only until audited (see §1).
- **Tenancy.** Kaneo has no RLS and no tenant id on child tables (task, relation, comment, value, time entry, link); isolation is application joins. Islestone's principle 5 and ADR 0002 §10 require `tenantId`, RLS policies and composite tenant FKs on every table. Do not port any query that relies on joining up to the workspace for isolation.
- **Data shapes ADR 0002 rejects:** custom values as one text column (multiselect as a JSON string); labels copied per task; sub-items as relation edges (no single parent, cross-project parents); integer positions; status as a free text slug and virtual statuses; renumbering on move with no alias; free-text enum columns validated only in code; `timestamp without time zone` for instants (use `timestamptz`).
- **Missing integrity Islestone requires:** the absent `BLOCKS` cycle check; `workflow_rule` upsert by find-then-insert with no unique index; `project.slug` uniqueness enforced only in code; no `unique(workspace_id, user_id)` on `workspace_member` in `schema.ts`.
- **Runtime patterns that do not fit Islestone:**
  - in-process `EventEmitter` events (`events/index.ts`), lost on crash, replaced by BullMQ and the notification outbox (1.6);
  - session-level advisory locks held across provider calls (`import-lock.ts`), which break behind PgBouncer in transaction mode (inflect-compliance's and Islestone's `DATABASE_URL`);
  - `xmin` as a revision (use `version`);
  - `console.log` everywhere (Islestone's lint bans `console` in `src/`).
- **Security:** `customBranchRegex` is a tenant-supplied regular expression compiled and run on the server for every push (`branch-matcher.ts`), a ReDoS vector. Offer the fixed templates only, or a bounded regex engine. Webhooks have no delivery-id replay store (H5 requires one). The integration `config` is stored as plain JSON text; Islestone stores tokens through field encryption (roadmap 5.3).
- **Out of scope:** billing (`billing/`, Creem), instance admin, the MCP server (`packages/mcp`, `apps/api/src/mcp`), mobile, the chat integrations (Discord, Slack, Telegram, Mattermost), and the better-auth `packages/permissions` (Islestone ports NextAuth v4 now, ADR 0004).

## 7. Attribution Islestone would carry

MIT requires the copyright notice and permission notice in "all copies or substantial portions". A translation from Drizzle/Hono into Prisma and Islestone usecases that reuses only the design is pattern-only, but to stay safe, any module that follows a Kaneo function closely carries the notice. Recommended:

**`PROVENANCE.md` row (one per adopted piece), for example:**

| Component | Source | Commit | Licence | Changes |
|---|---|---|---|---|
| Recurrence next-date algorithm | `usekaneo/kaneo` `apps/api/src/task/recurrence/next-occurrence-date.ts`, `create-next-occurrence.ts` | `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` | MIT, © 2024 Andrej Acevski | Re-implemented in TypeScript for the Islestone usecase layer; trigger moved to a `DONE`-category state and a BullMQ job; no file copied |
| Key extraction from branches and pull requests | `…/plugins/github/utils/branch-matcher.ts`, `issue-references.ts`, `services/resolve-pull-request-task.ts` | same | MIT | Rewritten; custom regex removed; resolves retired prefixes through `ProjectKeyPrefix` and `WorkItemKeyAlias` |
| Custom-field definition and option-change rules | `…/custom-field/assert-valid-definition.ts`, `choice-options.ts`, `plan-choice-value-changes.ts`, `resolve-field-update.ts` | same | MIT | Rules re-implemented over typed values and `CustomFieldOption` |
| GitHub binding verification and PR-event state moves | `…/github-integration/controllers/verify-repository-owner.ts`, `plugins/github/webhooks/push.ts`, `pull-request-opened.ts`, `pull-request-closed.ts` | same | MIT | Re-implemented on Islestone's automation rules, encrypted tokens and a delivery-id store |
| Importer intermediate model (only if used) | `usekaneo/kaneo` `packages/importers/src/types.ts` | same | MIT, © 2026 Kaneo MCP contributors | Re-shaped to Islestone's vocabulary |

**`NOTICE` entry:**

```
This product includes software adapted from Kaneo (https://github.com/usekaneo/kaneo),
commit fb890b4974e6dd6c232f1de6a6b70a591dfca0a3, licensed under the MIT License:

  MIT License

  Copyright (c) 2024 Andrej Acevski

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
```

If anything from `packages/importers`, `packages/mcp` or `packages/planka-import` is adapted, add a second block with "Copyright (c) 2026 Kaneo MCP contributors" (same MIT text); for `packages/cli`, "Copyright (c) 2026 Kaneo contributors". A source file that closely follows a Kaneo function also gets a header line: `Adapted from Kaneo (MIT, © 2024 Andrej Acevski), <path> at fb890b49; see NOTICE.`

## 8. Open questions for the owner

1. Confirm the approach for MIT sources: pattern-only rewrites recorded in `PROVENANCE.md`, or close translations that carry the `NOTICE` block. This study recommends the notice for any close translation.
2. Audit `packages/importers/src/plane/*` before 5.5 uses it as a reference, given Plane's AGPL status in roadmap 2.2.
3. Whether 5.3 includes two-way issue sync (§4.11) or only linking and state moves, as the roadmap prompt says. Two-way sync is about 3,600 lines in Kaneo (`plugins/sync`, the GitHub event handlers, echo and deferred-edit modules), mostly echo suppression and deferred edits.

## Licence check

**CORRECTED** (one minor fact; the licence verdict itself is confirmed). Independent re-check on 2026-11-18, read-only, nothing in the clone run or installed.

Confirmed:

- Pin: the clone's `HEAD` is `fb890b4974e6dd6c232f1de6a6b70a591dfca0a3` (2026-11-18 13:18 +0100, merge of PR #2237), full history (not shallow, 4,202 commits, first `3b8654f8` on 2024-12-30), clean working tree. `git ls-remote https://github.com/usekaneo/kaneo` reports the same SHA for both `HEAD` and `refs/heads/main`.
- Root `LICENSE`: standard MIT text, "Copyright (c) 2024 Andrej Acevski", 21 lines, 1,071 bytes, SHA-256 `cac4045c448a27879b14e2bd3619aade7569c651b35ee6bb0e48b3cefca88f1d`, git blob `ee7aa902ee64e3a1f5ddf8508d08d0a20d0b0fb4`.
- Upstream copy: `https://raw.githubusercontent.com/usekaneo/kaneo/fb890b4974e6dd6c232f1de6a6b70a591dfca0a3/LICENSE` returned HTTP 200 and is byte-identical to the clone's file (same SHA-256, same git blob id). The six sub-licence files fetched the same way at the same commit are byte-identical to the clone's too.
- History: `LICENSE` has exactly one commit, `c97fffcf` (2025-01-16, "chore: create LICENSE"), and its blob at that commit is the same `ee7aa902…` as at `HEAD`, so the text has never changed. No licence-like file was ever deleted; the only other history is additions and two pure renames (`docs/LICENSE` → `apps/docs/LICENSE`, `apps/mcp/LICENSE` → `packages/mcp/LICENSE`, both R100).
- Sub-licences: `packages/{importers,mcp,planka-import}` MIT "Kaneo MCP contributors" (2026); `packages/cli` MIT "Kaneo contributors" (2026); bodies byte-identical to the root MIT body. `apps/docs` MIT "Mintlify" (2023), same MIT body modulo whitespace. `scripts/slop-labeler/vendor` is the ISC permission text, "Copyright (c) 2026 kqr" (the file has no title line; the wording is ISC's).
- README: MIT badge (line 9) and "## License … MIT License - see LICENSE" (lines 72–74).
- No `NOTICE`/`COPYING`/`PATENTS` file, no `SPDX-License-Identifier` in any tracked file, no `ee/`, `enterprise/`, `commercial/`, `premium/` or `pro/` path, no CLA or licence terms in `CONTRIBUTING.md`. Every AGPL/GPL/BUSL mention in the tree is marketing copy in `apps/site/**` describing competitors' licences (for example Plane "AGPL-3.0", Vikunja "AGPLv3"); none is a licence grant on Kaneo code.

Corrected:

- Section 1 said `"MIT"` appears in **every** `packages/*/package.json`. `packages/email/package.json` has no `license` field (it is `"private": true`, so the root MIT `LICENSE` governs it). The row now lists the eight packages that do declare `"MIT"` and every package file that declares nothing.

Not verified: GitHub's own licence detection for the repository (the GitHub API is not enabled for this session); runtime dependency licences, as section 1 already says.
