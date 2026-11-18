# paca study

Read-only study for Islestone, 2026-11-18. Nothing in the clone was run, installed or built; every fact below was read from files at the pinned commit. Algorithms are restated in prose and pseudo-code, not copied. The two restricted directories named by the workflow (`apps/web/public/provider-logos/`, `services/api/internal/platform/bundledskills/content/`) were not read.

Focus, as asked: the web frontend's licence position (Apache-2.0 notice obligations) and the automation trigger / condition / action graph builder for roadmap 5.1.

## 1. Pin and licence facts

### As given by the workflow

- Clone at `scratchpad/oss-pins/paca/repo`, commit `5913718b6aaa81815085f1805dd764dbc5f55cce`, licence Apache-2.0.
- No directory under a different or commercial licence; no `ee/`, `enterprise/`, `pro/`, `vendor/` or `third_party/`; no SPDX headers; no BUSL, AGPL, GPL, Elastic, SSPL, Sustainable Use or Commons Clause text.
- Third-party material: `apps/web/public/provider-logos/` (20 SVG brand marks, said to come from `@lobehub/icons-static-svg`, MIT, no copy of that notice in the tree; other companies' trademarks). `services/api/internal/platform/bundledskills/content/` (skill markdown said to be adapted from `mattpocock/skills`, licence unverified).

### Verified in this session

| Fact | Value | How checked |
|---|---|---|
| Repository | `https://github.com/Paca-AI/paca` | `git remote -v` |
| Commit | `5913718b6aaa81815085f1805dd764dbc5f55cce`, 2026-11-18 23:38:53 +0700, "Merge pull request #783 from Paca-AI/feature/optimize-rendering-and-stability-of-task-components" | `git log -1` |
| Clone shape | `--filter=blob:none`, not shallow; 2,549 commits; 2,332 tracked files (765 under `apps/web/src`) | `git rev-parse --is-shallow-repository`, `git rev-list --count`, `git ls-files` |
| First commit | `655a7970`, 2026-03-20 10:38 +0700, "feat: initial commit" | `git log --reverse` |
| Licence history | `LICENSE` added in `df9e7912` at 2026-03-20 10:40 +0700 (two minutes after the first commit), never changed since | `git log -- LICENSE` |
| `LICENSE` text | The full Apache License 2.0 text including the appendix. The appendix boilerplate `Copyright [yyyy] [name of copyright owner]` is **unfilled**, so the licence file names **no copyright holder** | read |
| `NOTICE` file | **None** in the tree | `git ls-files` grep for `NOTICE`, `LICEN`, `COPYING`: only `LICENSE` and an unrelated component `inline-notice.tsx` |
| Copyright lines in source | None. The only "©" strings are UI copy: `apps/web/src/i18n/locales/*/auth.json` lines 37 ("© {{year}} Paca") and 149 ("© {{year}} Paca. All rights reserved.", translated per locale) | `git grep -i 'copyright\|SPDX\|(c) 20'` |
| `package.json` licence fields | `apps/extension` and `apps/mcp`: `"Apache-2.0"`. `apps/web`, `apps/e2e`, `services/realtime`: no field, so the root `LICENSE` governs. Go modules carry no licence field | read each |
| README | Licence badge line 12; "## License … Distributed under the **Apache License 2.0**" lines 544–546; "Not a business. No company sells Paca" line 87 | read |
| Contributor terms | `CONTRIBUTING.md` has no CLA and no DCO. Line 21: "contributions will not be relicensed into a closed or commercial edition". That is the project's promise about its own code, not a term of the licence; Apache-2.0 still allows commercial use downstream | read |
| Copyright holders | The contributors individually (no entity, no CLA). Top authors by commit: pikann22 (972), Hải Huỳnh (689), pikann (396), Mohammed Samiwala (174), copilot-swe-agent[bot] (137) | `git shortlog -sn` |
| Web stack | Vite + React 19 + TanStack Router/Query/Form + shadcn-style components (`apps/web/components.json`, style `base-nova`) + `@base-ui/react`; graph canvas is `@xyflow/react` locked at 12.11.1 (`@xyflow/system` 0.0.78) in `apps/web/bun.lock`; editor is BlockNote 0.48.1 (`@blocknote/core`, `react`, `shadcn`; no `xl-*` package) | `apps/web/package.json`, `bun.lock` |

### Added to the restricted list by this study

- `apps/web/src/components/ui/` (65 files). `components.json` shows they were generated with the shadcn CLI. shadcn/ui is MIT upstream; no shadcn copyright notice is in the tree. I did not verify each file's origin. Islestone has its own primitives (`@inflect/ui`, roadmap 2.1), so it should take nothing from this folder.
- `apps/web/src/i18n/locales/**` strings that say "All rights reserved". They are UI copy, not a licence term, but they contradict the Apache grant; Islestone writes its own messages anyway.

### Not verified

- Licences of Paca's npm and Go dependencies. The lockfile format (`bun.lock`) carries no licence fields. (Licence check: the one exception is `apps/extension/package-lock.json`, which does carry them: 29 MIT, 9 "MIT OR Apache-2.0", 2 Apache-2.0, 1 ISC, 1 BSD-3-Clause and 12 MPL-2.0, the 12 being `lightningcss` and its platform binaries, all dev-only. These are third-party npm packages named in a lockfile, not code in Paca's tree.) I believe `@xyflow/react` is MIT and `@blocknote/core` is MPL-2.0 from prior knowledge, not from this tree. Islestone takes none of them by porting; anything it adopts goes through its own licence gate (`npm run licence:check`).
- `mattpocock/skills` licence (restricted directory, not read).
- Who, legally, "Paca" is. There is no entity in any file I read.

### What Apache-2.0 requires of Islestone, specifically for frontend code

Apache-2.0 obligations attach when Islestone **redistributes** the Work or a Derivative Work. For a SaaS, server code is not distributed, but **the browser bundle is**: every visitor receives the compiled JavaScript. So:

| Clause | Obligation | At this commit |
|---|---|---|
| §4(a) | Give recipients a copy of the licence | Applies to any frontend code derived from Paca: ship the Apache-2.0 text with the bundle (a third-party-licences page or asset) |
| §4(b) | Modified files carry prominent notices that Islestone changed them | Applies to any derived source file, frontend or backend |
| §4(c) | Retain copyright, patent, trademark and attribution notices from the source files | None exist in the automation files or anywhere else in the tree |
| §4(d) | If the Work has a `NOTICE` file, carry its attribution notices | **No `NOTICE` exists**, so nothing to carry today. Islestone's `PROVENANCE.md` row says "Apache-2.0 requires its NOTICE file to be carried": correct as a rule, empty in effect. Re-check at every re-pin; a `NOTICE` added later would bind |
| §6 | No trademark licence | Do not use the name "Paca" or its marks except to state origin |
| §3 | Patent licence from contributors; terminates for a party that sues claiming the Work infringes | Nothing to do; note it |

If Islestone only learns designs (this study's recommendation for almost everything), no Apache obligation attaches. Islestone's principle 6 still asks for a `PROVENANCE.md` row marked "pattern only, no code copied".

## 2. Where the automation code lives

Line counts are `wc -l` at the pinned commit. Tests are listed separately.

### Backend (Go) — the engine and its rules

| Path | Lines | Content | Worth porting? |
|---|---|---|---|
| `services/api/internal/domain/automation/entity.go` | 973 | Vocabulary: kinds, trigger and action types, config structs, targets, dynamic values, list modes, run and wait types | **Yes, the model** (§3, §4.3–4.4) |
| `services/api/internal/domain/automation/condition.go` | 450 | Leaf evaluation, operator-by-field matrix (214–235), relative dates `now±Nd` (397–410), any/all over target sets (187–205) | **Yes** (§4.3) |
| `services/api/internal/domain/automation/repository.go` | 187 | Repository contract incl. webhook-token verify-in-query and the "status referenced by automation" guard (160–180) | Ideas |
| `services/api/internal/domain/automation/{service,errors,cursor}.go` | 134 / 34 / 68 | Service interface, error set, list cursor | Error names only |
| `services/api/internal/service/automation/automation_service.go` | 1,515 | CRUD plus save-time graph validation: `Activate` 190–247, `AddNode` 273–303, `UpdateNode` 306–371, `AddEdge` 399–468, `validateEdgeHandle` 1258–1297, `wouldCreateCycle` 1302–1325, `hasCycle` 1330–1365, `validateNoSelfParent` 1382–1435, `validateTaskReachability` 1469–1515; per-type config validators 720–1240 | **Yes, the validation rules** (§4.6) |
| `services/api/internal/service/automation/cached_repository.go` | 333 | Redis cache of `LoadGraph`, invalidated by writes through the same decorator | Idea only |
| `services/api/internal/worker/automation_consumer.go` | 3,022 | The engine: event intake and self-trigger guard `handle` 451–554 (guard 459–476), `processEvent` 835–899, `fireChildChanged` 905–934, `triggerMatches` 940–966, `allWatchedTasksDone` 972–990, `runGraphWalk` 1035–1082, `finalizeRunIfDone` 1107–1136, `resumeWalk` 1208–1281, `resumeWalkFrom` 1313–1370, `walk` 1411–1456, `walkCondition` 1458–1492, `evaluateLeaf` 1628–1658, `evaluateChildCount` 1663–1700, `templateVars` 1725–1772, `resolveTargetTasks` 1797–1865, `walkWait` 1926–1953, `walkAction` 1955–2015, `runAction` 2095–2194, `applyCallAPI` 2372–2411, `applyUpdateTask` 2662–2840 | **Yes, the algorithms** (§4.1–4.5) |
| `services/api/internal/worker/automation_fields.go` | 391 | Materialising dynamic values, list modes and clears into one concrete update (`materializeFields` 18–108) | **Yes** (§4.4) |
| `services/api/internal/worker/automation_actions.go` | 239 | `add_comment`, `notify`, `link_task` handlers | Ideas |
| `services/api/internal/worker/{cron,due_date,wait}_scheduler.go` | 190 / 154 / 216 | Leader-locked minute tickers; cron catch-up collapse (cron 102–190) | **Yes, the catch-up rule** (§4.7) |
| `services/api/internal/pkg/vartemplate/render.go` | 75 | `{{var}}` substitution, unknown placeholders left verbatim, per-context escaping | **Yes** (§4.4) |
| `services/api/internal/service/git/automation.go` (+ `automation_runtime.go`) | 654 (+139) | Provider-neutral `git.*` triggers, conditions and actions | Ideas for 5.3 |
| `services/api/internal/transport/http/handler/automation_handler.go`, `dto/automation_dto.go` | 600 / 248 | REST surface | Route shape only |
| `services/api/internal/repository/postgres/automation_repository.go` | 1,187 | SQL (trigger lookup 655–676, predecessor lookup 678–690, due-date candidates 995–1010) | Query shapes; see §5 for defects |
| `services/api/internal/platform/netguard/netguard.go` | 333 | SSRF-safe HTTP client used by `call_api` | No: Islestone has `safeFetch` |
| Migrations `000027_add_automation_graph.sql` (215), `000033_add_automation_pending_waits.sql` (61), `000034_simplify_automation_status.sql` (19), `000029_migrate_legacy_automation_actions.sql` (99), `000080…` (19), `000081…` (9) | | DDL (§3) | **Yes, the shape** |

### Frontend (TypeScript, `apps/web`) — the builder

| Path | Lines | Content | Worth porting? |
|---|---|---|---|
| `apps/web/src/components/projects/automation/automation-canvas.tsx` | 481 | React Flow canvas: `NodeShell` 75–169, `branchesForNode` 191–218, `ConditionBranchRows` 220–293 (handle re-measure 240–254), `AutomationCanvas` 316–481 (drag-position hold 364–389, connect 409–419) | **Yes, as patterns** (§4.10) |
| `apps/web/src/components/projects/automation/automation-node-palette.tsx` | 219 | "Add trigger / condition / action" menus, grouped by event source | Pattern |
| `apps/web/src/components/projects/automation/automation-node-config-panel.tsx` | 3,981 | Per-type config forms: field-operation model `fieldOpsFor` 255, `parseFieldConfig` 279, `buildFieldConfig` 313; `TriggerConfigForm` 1077–1440; `TargetTaskPicker` 1441; `DateConditionValue` 1613; `TaskTargetSelector` 1691; `MatchModeSelector` 1748; `WebhookTokenSection` 1786; `ConditionConfigForm` 1907–2286; `ActionConfigForm` 2586–3712 | The field-operation model only; the forms are shadcn-bound and too large |
| `apps/web/src/components/projects/automation/automation-run-history-panel.tsx` | 168 | Runs list and per-node steps | Pattern |
| `apps/web/src/components/projects/automation/automation-dependency-map.tsx` | 54 | Which automations watch which tasks | Idea |
| `apps/web/src/routes/_authenticated/projects/$projectId/automation/$automationId.tsx` | 820 | Builder page: client-side reachability pre-check 219–268, random placement 493–496, one mutation per graph edit 498–610 | Pattern |
| `apps/web/src/routes/_authenticated/projects/$projectId/automation/index.tsx` | 371 | List page | No |
| `apps/web/src/lib/automation-api.ts` | 860 | TS mirror of the domain types (1–560) and the REST client | The type shapes |
| `apps/web/src/lib/automation-plugin-config.ts` | 81 | Plugin and Git node labelling | No |

### Agent-facing surface

| Path | Lines | Content |
|---|---|---|
| `apps/mcp/src/tools/automation-tools.ts` | 610 | Four tools (`get_automation`, `create_automation`, `update_automation`, `delete_automation`); new nodes carry a caller-chosen `ref` (65–70) so edges in the same call can name them; ref resolution 312–360; per-item outcomes |
| `apps/mcp/src/api/automation-client.ts` | 266 | REST client |

### Tests worth reading as specifications (rewrite, do not copy)

`domain/automation/condition_test.go` (399), `service/automation/automation_service_test.go` (919), `worker/automation_consumer_test.go` (2,627), `worker/automation_actions_test.go` (348), `worker/automation_create_task_test.go` (121), `test/e2e/automation_engine_test.go` (2,818), `test/e2e/automation_engine_new_nodes_test.go` (823), `apps/web/.../automation-node-config-panel.test.tsx` (262), `apps/e2e/features/projects/automation.feature` (241, Gherkin scenarios for list, create, toggle, palette, config, run history and permissions), `git-automation*.feature` (77 + 74), Playwright specs `automation.spec.ts` (942) and `automation-nodes.spec.ts` (883).

`docs/architecture/automation-workflows.md` (412) is marked **superseded** at its top: it describes the older task-wrapping workflow DAG. Its AND-join and loop-safety reasoning still applies to the `predecessor_done` trigger; its API section does not.

## 3. Data model (transcribed compactly)

Current shape after migrations 27, 33, 34 and 81. `PK` primary key, `FK→x` foreign key with its on-delete rule, `?` nullable.

```
automations
  id PK uuid · project_id FK→projects CASCADE · name varchar(255) · description text?
  status varchar(20) CHECK in ('active','inactive') DEFAULT 'inactive'      -- mig 34 collapsed draft/active/archived
  created_by FK→project_members SET NULL ? · created_at · updated_at · deleted_at?   -- soft delete
  idx (project_id) WHERE deleted_at IS NULL

automation_nodes
  id PK · automation_id FK→automations CASCADE
  kind varchar(20) CHECK in ('trigger','condition','action')
  type varchar(100)            -- built-in name or reverse-DNS plugin name, e.g. git.pr_state_changed
  config jsonb DEFAULT '{}'    -- every type-specific field (see config shapes below)
  pos_x, pos_y double · created_at · updated_at
  idx (automation_id) · idx (type) WHERE kind = 'trigger'

automation_edges
  id PK · automation_id FK CASCADE · source_node_id FK→nodes CASCADE · target_node_id FK→nodes CASCADE
  source_handle varchar(100)?  -- NULL for trigger/action sources; a branch handle or 'else' for a condition
  CHECK source_node_id <> target_node_id
  UNIQUE (source_node_id, COALESCE(source_handle,''), target_node_id)
  idx (automation_id, source_node_id) · idx (target_node_id)

automation_runs                       -- one graph execution
  id PK · automation_id FK CASCADE · trigger_node_id FK→nodes CASCADE · task_id FK→tasks CASCADE ?
  status CHECK in ('running','completed','failed') · started_at · finished_at?
  idx (automation_id, started_at DESC) · idx (task_id)

automation_run_steps                  -- one row per node visited
  id PK · run_id FK CASCADE · node_id FK CASCADE
  status CHECK in ('completed','failed','skipped') · input_snapshot jsonb? · output_snapshot jsonb? · error text?
  executed_at · idx (run_id, executed_at)

automation_due_date_fires   PK (node_id, task_id) · automation_id FK · fired_at        -- one-shot per (node, task)
automation_cron_fires       PK node_id · automation_id FK · last_fired_at · updated_at  -- recurring anchor
automation_webhook_tokens   id PK · node_id FK · automation_id FK · token_prefix varchar(8) · token_hash varchar(64)
                            created_by FK→members SET NULL? · created_at · last_used_at? · revoked_at?
                            UNIQUE (node_id) WHERE revoked_at IS NULL
automation_pending_agent_waits  id PK · run_id FK · node_id FK · automation_id FK · conversation_id FK UNIQUE
                                project_id FK · context jsonb (WalkContext) · created_at · idx (run_id)
automation_pending_delays       id PK · run_id FK · node_id FK · automation_id FK · project_id FK
                                context jsonb · resume_at timestamptz · idx (resume_at) · idx (run_id)
notifications.message text?  (mig 81, for the notify action; type 'automation' added to its CHECK)
```

Config shapes stored in `automation_nodes.config` (all fields optional unless noted):

```
TriggerConfig   status_id · tag · due_date_offset_minutes · watched_task_ids[] · target_task_id
                cron_expression (5-field, UTC) · field (one of 10 changed-field names) · sprint_id
ConditionConfig branches[]: { handle (required), label, tree: Leaf }      -- N-branch switch, first true wins
Leaf            field · field_key (custom field) · operator · value · target: TaskTarget · match_mode ('any'|'all')
TaskTarget      kind: self | parent | children | siblings | blocks | is_blocked_by | relates_to
                      | duplicates | is_duplicated_by | other ;  other_task_id
ActionConfig    update: TaskFieldUpdate · create: TaskCreate · comment {text} · notify {recipients[], member_ids[], message}
                link {type, to: TaskTarget} · method/url/headers/body (call_api) · member_id + message (trigger_ai_agent)
                wait_minutes · sprint_update · move_to_sprint_id · target: TaskTarget
TaskFieldUpdate typed sparse fields (state, type, sprint, parent, title, description, importance, story_points,
                assignee_ids, reporter_id, custom_fields{}, dates, tags) + tags_mode/assignees_mode ('set'|'add'|'remove')
                + clear[] + dynamic{field: {source: task|parent|now, field?, offset_days?}}
WalkContext     task_id? · sprint_id? · event_vars{}     -- snapshot persisted on a pause
```

Vocabulary in the engine: 18 built-in trigger types (`entity.go` 77–127), one deterministic condition type plus an external-AI one (`jev_condition`, 158–194), 10 built-in action types (202–254), 7 operators and 19 fields (`condition.go` 19–66).

## 4. Algorithms (prose and pseudo-code; no code copied)

### 4.1 Event intake and trigger matching (`automation_consumer.go` 451–990)

Events arrive on a Redis stream that the task-activity pipeline already writes. The engine is a sibling consumer group, not a call from the HTTP handler.

```
on activity message m:
  if m.origin == 'automation': ack; return            # the whole loop-safety mechanism (4.8)
  candidates = map activity type / changed fields to trigger types
      created → task_created; comment → comment_added; link → link_added; attachment → attachment_added
      updated: per change: status → status_changed (+ check predecessors); assignee → assignee_changed;
               importance → priority_changed; tags → tag_added only if a tag was ADDED;
               any of 10 watched fields → field_changed
  task = reload task fresh                             # payload carries names and diffs, not ids
  for type in candidates:
    for trigger node in active automations of this project with this type:
      if config filter matches the task's CURRENT state: start a run
  if task has a parent and (created or state changed): run child_changed triggers with the PARENT as the walk's task
  if state changed: for each predecessor_done trigger whose watched list contains this task:
      if every watched task is now in a DONE-category state (re-read live): start a run on its target task
  on error: do not ack (redelivered later); else ack
```

Every matching automation runs independently; there is no cross-automation priority. Competing outcomes are meant to be one condition node's branches.

The AND-join for `predecessor_done` is **stateless**: no progress counter, just a fresh "are all of them done now?" read per event, which is idempotent under redelivery.

### 4.2 The graph walk (`runGraphWalk` 1035, `walk` 1411, `walkCondition` 1458, `walkAction` 1955)

```
run = insert run(status running, trigger node, task?)
visited = {}
for edge out of trigger: walk(edge.target)
finalizeIfDone(run)

walk(node):
  if node in visited: return; visited += node          # guards diamonds and any bad data
  if node needs a task and the walk has none: record failed step; return
  condition → evaluate branches in order; first true wins, else 'else'; record step {matched_handle};
              follow only edges whose source_handle == matched handle
  wait      → record step {resume_at}; insert pending delay; STOP this branch
  action    → apply; record step completed | skipped (nothing changed) | failed;
              failed: STOP this branch (siblings continue)
              trigger_ai_agent that started conversations: insert one pending wait per conversation; STOP
              otherwise follow every outgoing edge

finalizeIfDone(run): if no pending waits and no pending delays for the run:
   status = failed if any step failed else completed; set finished_at
```

Points to keep in mind:

- The walk is depth-first and synchronous inside the consumer.
- "Visited once" makes a node with two incoming paths an **OR-join**: it runs on the first arrival. `predecessor_done` is the only AND-join.
- A failure stops only its own branch.

### 4.3 Conditions (`condition.go`, `evaluateLeaf` 1628, `resolveTargetTasks` 1797)

- A branch's tree is **one leaf** (no AND/OR/NOT). A two-branch condition is an if/else.
- **Operator-by-field matrix** (`validOperatorsByField`): each field lists the operators its comparator really implements, and validation refuses any other pair. Example: priority allows equals, not_equals, greater_than and less_than; assignees and labels allow contains, not_equals, is_empty and is_not_empty. Without this, an unimplemented pair silently evaluates false forever.
- **Comparators by kind:**
  - id: equals means present and equal;
  - number: also accepts the numeric string a web form stores;
  - set: contains and not_equals mean membership;
  - text: contains means substring;
  - date: RFC 3339 or relative `now`, `now+Nd`, `now-Nd`, in whole days.
- **Unset values:** an unset field passes only `is_empty`. A missing custom-field key passes only `is_empty`.
- **Targets:** a leaf can be evaluated against items related to the walk's item: self, parent, children, siblings (the parent's other children), the five relation directions, or an explicit other item. `match_mode` decides how several resolved items combine: `any` (the default) or `all`. **An empty resolved set is false in both modes**, so "all blocking items done" is false when there are none. This is the same "zero is never complete" rule inflect-compliance holds.
- `child_count` is computed by the walker, not by the leaf.

```
evaluate(leaf):
  if leaf is nil: true
  targets = resolve(leaf.target relative to walk item)      # [] when the relation has no members
  if targets empty: false
  results = [compare(field(t), op, value) for t in targets]
  return all(results) if match_mode == 'all' else any(results)
```

### 4.4 Actions (`runAction` 2095, `applyUpdateTask` 2662, `materializeFields`, `vartemplate`)

- **Idempotency by diff.** `update_task` builds an update containing only fields whose target value differs from the current one. No difference means `applied=false` and the step is recorded "skipped". This is what makes a redelivered event harmless for field writes.
- **List modes.** Labels and assignees accept `set` (replace), `add` and `remove`. Add and remove are folded against the current list into a final replacement before the diff. `clear[]` is the only way to empty a field, because an unset field means "leave alone".
- **Dynamic values.** A field can be computed at run time from the walk's item, its parent or now, optionally another field, plus `offset_days` for dates. An empty source leaves the field untouched. A dynamic value overrides the fixed one.
- **Templates.** `{{namespace.key}}` substitution with no expressions:
  - an unknown key is left **verbatim**, so an unresolved placeholder is visible rather than silently blank;
  - substituted values are escaped for their context (query-escaped in a URL, newlines stripped in a header) and the static template text is not;
  - rich text is rendered per text node of the decoded document, so a quote in a value cannot break the JSON.
- **Fan-out.** An action with a multi-valued target applies once per resolved item and stops at the first error. The step's output lists each item's result.
- **Create child item.** It is idempotent per parent and rendered title: if the parent already has a child with exactly that title, nothing is created. The fields it sets are recorded as "set by the creator" (`createdUserSetKeys`, `automation_consumer.go` about 2341), so Paca's Jev AI autofill leaves them alone. That protects against autofill, not against other automations; Islestone has no autofill and does not need it.
- **Outbound HTTP (`call_api`):**
  - always executes, with no idempotency;
  - a non-2xx response fails the step;
  - the stored response body is capped at 4 KiB;
  - it uses an SSRF-safe client.
- **Not idempotent under redelivery:** comment, notify, call_api and agent trigger.

### 4.5 Pausing and resuming (`walkWait` 1926, `walkAction` 1983–2010, `resumeWalk` 1208, `resumeWalkFrom` 1313)

```
pause at node N: insert pending row {run, node N, kind (delay resume_at | agent conversation id), WalkContext}
resume (scheduler sees resume_at passed | conversation reached a terminal status):
  atomically delete this pending row AND count the run's remaining rows for node N   # sibling accounting
  if conversation failed or stopped: record failed step on N
  if remaining > 0: return                        # a fan-out still has conversations out
  if any failed step on N or automation inactive: return
  reload graph, item and cycle FRESH; visited = node ids of the run's recorded steps
  walk each edge out of N
  finalizeIfDone(run)
```

The delete-and-count is one statement, so two siblings resolving at once cannot both see "one remaining". Failures after that point are recorded as steps and swallowed, because the row a retry would need is already gone.

### 4.6 Save-time graph validation (`automation_service.go`)

Checked on every edge add, on config updates of triggers and update actions, and again in full at activation:

1. No self-loop. No edge **into** a trigger.
2. **Handle rule.** A trigger or action source takes no handle. A condition source needs one: a declared branch handle, `else`, or the fixed handle set of special condition types.
3. No duplicate (source, handle, target).
4. **No cycle.** On add: DFS from the new edge's target; refuse if it reaches the source. At activation: white/grey/black DFS over the whole graph.
5. **Reachability of an item.** A trigger that can fire with no item (cron, inbound webhook, predecessor_done without a target) may not reach, through any number of hops, a node that needs an item (`NodeRequiresTask`). This is a whole-graph BFS, not just the new edge.
6. **No self-parent.** An update that would make the walk's fixed target item its own parent is refused at save time, because at run time it would fail every run quietly.
7. **Activation** needs at least one trigger and one action, every node's config valid in **strict** mode (required fields present), and checks 4–6.

Graph edits are allowed while active. The engine reads the graph fresh per event, so an edit applies from the next event; a paused run resumes into the edited graph.

### 4.7 Schedulers (`cron_scheduler.go` 102–190, `due_date_scheduler.go`, `wait_scheduler.go`)

- Each is a one-minute ticker behind a Redis `SET NX` leader lock (TTL two intervals).
- **Cron catch-up collapse:**
  - anchor = last fired, or the node's creation time;
  - `next = schedule.next(anchor)`; not due if `next > now`;
  - otherwise walk forward on the schedule grid to the last occurrence ≤ now, and fire **once**;
  - record the fire as that grid time, not wall-clock now (no drift), and **before** executing (at-most-once across a leader handoff).
- **Due-date** is one-shot per (node, item): a fired pair is recorded and never re-armed.
- **Wait** polls `resume_at <= now`.

### 4.8 Loop safety

Every write the engine makes is emitted with `origin = 'automation'`, and the consumer drops such events before matching (451–476). So **an automation can never trigger another automation, or itself**. Writes by people and agents still trigger. The code comment says that if chaining is ever wanted, the fix is "a bounded hop counter or a per-walk id". That is exactly Islestone's roadmap 5.1 ("a per-chain depth limit"); §6.2 designs it.

### 4.9 Inbound webhook trigger (`GenerateWebhookToken` 560, `HandleWebhookTrigger` 602, mig 27)

- A random token is shown once. Its 8-character prefix and SHA-256 hash are stored.
- Verification compares hashes inside the query. A wrong hash and "no token was ever generated" return the same error (`repository.go` comment on `VerifyWebhookToken`), and `HandleWebhookTrigger` (596–601) returns only `ErrNotFound` or `ErrWebhookTokenInvalid` whatever was wrong, so an unauthenticated caller cannot probe which webhooks exist. The two are still different errors; Islestone should collapse them into one.
- At most one live token per node, held by a partial unique index; rotating revokes and inserts in one transaction.
- The receiver route is public and authenticates with an `X-Webhook-Token` header (`router.go` 1221–1229).

### 4.10 The builder UI (`automation-canvas.tsx`, `$automationId.tsx`)

- **One node component for all kinds.** A coloured card per kind, an input handle on the left (not on triggers), and either one output handle or one output row per condition branch plus a final "else" row.
- **Branch handles change at run time.** React Flow caches handle positions, so after the branch set changes the node calls `useUpdateNodeInternals(nodeId)` one frame later (240–254). Without it, new branches cannot be connected. This is the most useful single lesson in the frontend.
- **No snap-back after a drag.** The dragged position is held in a pending map until the refetched server position matches it (364–389). That gives optimistic drag on top of server-authoritative data, which is ADR 0005's model.
- **Client pre-check before `addEdge`.** The same task-reachability BFS runs in the browser and shows a toast instead of a 4xx. The client's "needs an item" list has drifted from the server's (§5, item 1).
- **Every graph edit is its own REST mutation** followed by a refetch of the whole graph. New nodes are placed at random coordinates (493–496) and open their config panel.
- **The palette** is grouped by event source (task events, task activity, cycle events, schedule and webhook; task, flow and cycle actions). Git and plugin node types appear in their own sections.
- **The config panel's field-operation model** (`fieldOpsFor`, `parseFieldConfig`, `buildFieldConfig`) gives each updatable field a row with an operation (set, add, remove, clear or dynamic) and a value editor. It parses to and from the stored config. Worth reproducing with `@inflect/ui` `FormField` and `Combobox`.
- **Branch handle ids** are minted in the browser as `branch_<n>_<base36 time>` (`ConditionConfigForm`, about line 1954).
- **Run history** lists runs, then each run's steps by node with input and output snapshots.

### 4.11 Agent-facing tools (`apps/mcp/src/tools/automation-tools.ts`)

- An earlier version had 16 tools; these four replaced them because the agent could not tell which to use.
- `create_automation` and `update_automation` take a whole graph:
  - new nodes carry a caller-chosen `ref`, and edges in the same call name nodes by ref;
  - every item is applied independently and reported per item;
  - removing something unknown is a no-op, so a retry is safe.
- Positions are optional here and default to (0, 0) (`automation-tools.ts` 331, 349); `get_automation` prints every node's position so an agent can continue a layout (301). The layered-layout guidance and the spacing warning (300 × 200 px, `checkNodeSpacing`) described in the superseded `docs/architecture/automation-workflows.md` belonged to the old workflow tools and are **not** in the current file. Islestone should lay out a proposed graph on approval by code, as inflect-compliance's process-map proposals do (pattern only), rather than trusting agent coordinates.

## 5. Defects and gaps observed (do not reproduce)

1. **Two copies of "which nodes need an item".** The server's `NodeRequiresTask` (`entity.go` 284–298) exempts call_api, trigger_ai_agent, wait, update_sprint and complete_sprint. The client's `nodeRequiresTask` (`$automationId.tsx` 219–225) exempts only the first two. They have already drifted. Islestone: one pure, client-safe module imported by both sides, the same lesson as inflect-compliance's `write-ladder.ts`.
2. **Agent runs started by automation skip authorisation.** `triggergate/gate.go` lines 11–13: "A trigger with no member behind it (an unattended automation firing) is not checked." The engine also records automation writes with no actor. ADR 0003 requires the rule's accountable author, re-read at run time.
3. **Secrets in plain config.** call_api headers and body are stored and returned verbatim to anyone who can read the automation; the code says so in `entity.go` 574–580.
4. **The predecessor lookup has no project filter and no index.** `ListPredecessorTriggersWatching` (repository 678–690) matches on JSONB containment of `watched_task_ids` with no `project_id` filter, and no GIN index exists on `config`.
5. **Redelivery duplicates runs.** A run has no event id or uniqueness, so a redelivered event starts a second run. Field writes are safe by diff; comment, notify, call_api and agent triggers repeat.
6. **Orphan edges.** Removing a condition branch in the panel leaves any edge on that handle in place. I found no code that removes it on `UpdateNode` or refuses it at `Activate`. The walk then never follows it.
7. **Due-date triggers never re-arm.** A fire is one-shot per (node, item), so moving an item's due date later never fires again.
8. **No limiter on the public webhook route.** The automation receiver (`router.go` 1228) has no route-level limiter, unlike the Git receiver on line 1238 (`authLimit`). A global limiter elsewhere was not checked.
9. **No execution budget.** Nothing limits executions per project or per tenant. Paca's only flood defence is the no-chaining rule.
10. **Ghost references.** Item and member references live inside JSONB with no foreign key. The engine compensates with a conservative "is this state referenced anywhere in any config blob" guard before a state can be deleted (`repository.go` 172–179).

## 6. Mapping onto Islestone

### 6.1 Sub-phases and ADRs

| Paca part | Islestone sub-phase | Treatment |
|---|---|---|
| Graph model (nodes, handles, edges), walk, conditions, actions, validation, run steps | **5.1** automation engine and builder | Design source for the builder and the executor, layered on inflect-compliance's bus pattern (roadmap 5.1 "Source"; not read in this study) |
| Canvas, palette, branch rows, config field-operation model, run history | **5.1** builder; React Flow is the roadmap 2.3 pick | Rewrite on `@inflect/ui` and Next.js; pattern only |
| Inbound token trigger (`api_trigger`), outbound `call_api` | **5.2** API and webhooks | Token scheme as §4.9. Outbound goes through `safeFetch` and the `webhook-headers.ts` pattern (signed, idempotency key); header secrets are encrypted |
| `git.*` triggers, conditions and actions behind a provider SPI | **5.3** source control ("move item state on pull-request events through automation rules") | Idea: providers normalise events; the rule vocabulary is provider-neutral |
| `trigger_ai_agent` with a pause until the conversation ends | **6.3** agents as delegates; ADR 0003 invocation `AUTOMATION` | Becomes an `AgentSession` started under the rule author's authority; the execution waits on the session's terminal state (`COMPLETE`, `ERROR`, `STALE`). The agent still writes through proposals |
| MCP graph tools with refs | **6.2** MCP server and proposals | An agent's `create/update automation rule` becomes **one proposal** carrying the whole graph. Approval creates it inactive, and a person activates it. Re-mint the agent's refs on approval, as inflect-compliance does for process-map proposals (pattern only) |
| `create_task` with templates and parent+title idempotency | 2.5 templates and recurrence | Idea |
| `due_date_reached`, cron | 1.6 jobs; 3.x planning | BullMQ repeatable job per minute with the catch-up collapse (§4.7) |
| Cycle triggers and actions | 2.5 cycles | Cycle started, completed and so on; "complete cycle" moves the open items |
| — | 2.6 intake | Add `intake_request.created` and `.accepted` triggers, which Paca lacks |
| Loop, flood and failing-action behaviour | **H5** | §6.2 adds what Paca lacks |
| `predecessor_done` | ADR 0002 §6 relations | Express it as "every item that BLOCKS the target is in a DONE-category state", read live, rather than a free list of ids, or keep an explicit list in a join table. Note ADR 0002 §3 also has a `CANCELLED` category; decide whether cancelled counts as done |
| Item fields, states, labels, relations, sub-items | ADR 0002 | Paca's status → `WorkflowState` (`stateId`, category `DONE`); task → `WorkItem`; subtask → sub-item; tags → `Label`; link_task → `WorkItemRelation` (`BLOCKS`, `RELATES`, `DUPLICATES`); importance → `WorkItemPriority`; custom fields → typed `CustomFieldValue`, keyed by field id, not by a JSON key. **Assignees**: Islestone has one assignee, so the list modes for assignees collapse to set or clear |
| Vocabulary | ADR 0006 | Automation → `AutomationRule`; run → `AutomationExecution`; run step → a new `AutomationExecutionStep`; node and edge → new rows (for example `AutomationRuleNode`, `AutomationRuleEdge`). Those need an ADR 0006 amendment before the first model (rule 1). "Workflow" is banned for automation, which matches Paca's own rename. Sprint → Cycle. "Trigger" is allowed only as one part of a rule |
| Live edit with fresh reads | ADR 0005 | Keep server-authoritative data; add a rule `version` (optimistic concurrency, as ADR 0002 §9) and pin it on each execution, so a paused execution resumes on the version it started with or ends refused |
| Provenance | ADR 0001 | Paca is not inflect-compliance, so the BUSL interim rule does not block it. Apache-2.0 allows translation with §4 attribution. This study still recommends **pattern only** for everything; §8 gives the text for any close translation |

### 6.2 What Islestone needs that Paca does not have (H5)

**Chain depth instead of "never chain".** Every automation event envelope carries `chainId` and `chainDepth`:

- A person's or an agent's write starts a new chain at depth 0.
- An event emitted by an execution's action carries the execution's `chainId` and depth + 1.
- The executor refuses to start an execution when the depth exceeds `MAX_CHAIN_DEPTH` (for example 3), or when the chain has already run (`ruleId`, `workItemId`), which stops A → B → A ping-pong before the depth cap.
- A refusal writes an execution row with a named reason (`CHAIN_DEPTH_EXCEEDED`, `CHAIN_REVISIT`) rather than vanishing.

**One execution per event.** `AutomationExecution` gets a unique key on (`tenantId`, `ruleId`, `triggerEventId`). A redelivered event then cannot start a second execution, which fixes §5 item 5.

**Budgets.**

- Per-tenant and per-rule execution counters per window, reserved before the execution starts (ADR 0003's reserve-before-the-run rule).
- A refusal records `BUDGET_EXCEEDED`.
- `call webhook` actions also carry a per-connection rate.

**Authority.**

- An execution runs as the rule's **accountable author**, whose membership and permission keys are re-read when the execution starts (ADR 0003 §4). If they lost the key, the execution is refused with a named reason.
- Every write goes through the real usecases, so `requirePermission`-equivalent checks, Zod, sanitisation and `logEvent` apply. The audit row names the rule and the author.
- "Start an agent run" starts an `AgentSession` with invocation `AUTOMATION` and `automationRuleId`.

**Typed references.** Write the ids a node's config references (states, members, labels, items, cycles) into an `AutomationRuleReference` side table in the same transaction as the node save, with `tenantId` and RLS. This replaces the JSONB containment guard (§5, item 10) and the unindexed predecessor scan (§5, item 4). Config stays JSONB, validated by one Zod discriminated union per node type that both the server and the client import.

**Orphan edges.** Saving a condition's branches deletes, in the same transaction, the edges whose handle no longer exists. Activation refuses any edge with an undeclared handle.

**Secrets.** `call webhook` header values are encrypted through field encryption, never returned to the client (show a prefix only), and the request goes through `safeFetch`.

**Prisma sketch (illustrative, not final).** Every table has `tenantId`, a tenant-leading index, RLS in its migration, and composite foreign keys that keep both ends in one tenant (ADR 0002 §10).

```
AutomationRule          id · tenantId · projectId? · teamId? · name · description? · status ACTIVE|INACTIVE
                        authorMembershipId (accountable author) · version int · createdAt · updatedAt · deletedAt?
AutomationRuleNode      id · tenantId · ruleId · kind TRIGGER|CONDITION|ACTION · type · config Json · posX · posY
AutomationRuleEdge      id · tenantId · ruleId · sourceNodeId · sourceHandle String @default("") · targetNodeId
                        @@unique([tenantId, sourceNodeId, sourceHandle, targetNodeId])   -- '' not NULL: Prisma cannot COALESCE
                        CHECK sourceNodeId <> targetNodeId
AutomationRuleReference tenantId · nodeId · refKind STATE|MEMBER|LABEL|WORK_ITEM|CYCLE · refId · @@index([tenantId, refKind, refId])
AutomationExecution     id · tenantId · ruleId · ruleVersion · triggerNodeId · triggerEventId · workItemId? · cycleId?
                        chainId · chainDepth · status RUNNING|COMPLETED|FAILED|REFUSED · refusalReason? · startedAt · finishedAt?
                        @@unique([tenantId, ruleId, triggerEventId])
AutomationExecutionStep id · tenantId · executionId · nodeId · status COMPLETED|FAILED|SKIPPED · input Json? · output Json? · error? · at
AutomationExecutionWait id · tenantId · executionId · nodeId · kind DELAY|AGENT_SESSION · resumeAt? · agentSessionId? @unique · context Json
AutomationScheduleFire  tenantId · nodeId @id · lastFiredAt
AutomationInboundToken  id · tenantId · nodeId · prefix · hash · createdBy? · lastUsedAt? · revokedAt?  (partial unique on live)
```

Paca's two wait tables become one with a `kind`, because their shape is identical apart from what they wait on.

## 7. What Islestone must NOT take

There is **no copyleft code** in Paca to avoid. Everything at this commit is Apache-2.0 apart from the third-party material below. Do not take:

- **`apps/web/public/provider-logos/`** and **`apps/web/src/lib/provider-logos.ts`'s assets.** They are other companies' trademarks, and the MIT notice of their source is missing from the tree.
- **`services/api/internal/platform/bundledskills/content/`.** Its provenance is unverified (said to be adapted from `mattpocock/skills`), and Islestone's skills must carry their own evaluation records anyway (ADR 0003, roadmap 6.x).
- **`apps/web/src/components/ui/`**, the shadcn-generated primitives. They are MIT with no notice in the tree, and Islestone has `@inflect/ui`.
- **The `jev_condition` node** (`entity.go` 151–194, `walkJevCondition` 1499 onward, `internal/platform/jev`). It routes on an answer from an external AI decision API, a new sub-processor that sees item content. Islestone's AI belongs in its own engine behind the guard and the proposal queue (principles 2 and 4). A "condition decided by a model" would have to be an agent run whose output is a proposal, not a branch.
- **The WASM plugin automation bridge** (plugin-contributed node types, `runPluginAction`, `evaluatePluginCondition`). It is outside the roadmap and is a sandbox surface Islestone has not designed.
- **The no-authority agent trigger and the actorless writes** (§5, item 2).
- **Plain-text secrets in node config** (§5, item 3).
- **The name "Paca", its logo, and its UI copy**, including the "All rights reserved" strings.
- **Paca's dependency choices by implication.** TanStack Router and Start, BlockNote (Islestone uses Tiptap per roadmap 2.3) and `@base-ui/react` are not Islestone's stack. `@xyflow/react` (React Flow, MIT) is Islestone's own pick in roadmap 2.3 and enters through the licence gate on its own merits.
- **`proOptions={{ hideAttribution: true }}`** on the canvas (`automation-canvas.tsx` 459). MIT allows it, but React Flow asks commercial users who hide the attribution to subscribe to React Flow Pro. That is an owner decision, not something to copy by default.

## 8. Attribution Islestone would carry

**Recommended default: pattern only.** Islestone re-designs the model and the algorithms in TypeScript for its own usecase layer and copies no file, function or block. Then no Apache obligation attaches. Principle 6 still requires a `PROVENANCE.md` row.

**`PROVENANCE.md`: update the existing UNPINNED row** ("Paca web: automation graph builder (5.1) … Not identified") to:

| Component | Source | Commit | Licence | Changes |
|---|---|---|---|---|
| Automation rule graph: node kinds, branch handles, walk, condition leaf semantics and operator matrix, target resolution with any/all and empty-is-false, field-update diff with list modes, clears and dynamic values, `{{var}}` templates, pause and resume accounting, save-time graph validation, cron catch-up | `github.com/Paca-AI/paca`: `services/api/internal/domain/automation/entity.go`, `condition.go`; `services/api/internal/service/automation/automation_service.go`; `services/api/internal/worker/automation_consumer.go`, `automation_fields.go`, `cron_scheduler.go`; `services/api/internal/pkg/vartemplate/render.go`; migrations `000027`, `000033`, `000034` | `5913718b6aaa81815085f1805dd764dbc5f55cce` | Apache-2.0 (root `LICENSE`, unchanged since `df9e7912`); no `NOTICE` file; no copyright holder named | Pattern only, no code copied. Re-designed for Prisma, RLS, ADR 0002 vocabulary and ADR 0003 authority; adds chain depth, per-event uniqueness, budgets, encrypted secrets and typed references |
| Automation builder UI patterns: one node shell with per-branch output handles and handle re-measure, drag-position hold, client-side reachability pre-check, grouped palette, field-operation rows, run history | `apps/web/src/components/projects/automation/automation-canvas.tsx`, `automation-node-palette.tsx`, `automation-node-config-panel.tsx`, `automation-run-history-panel.tsx`; `apps/web/src/routes/_authenticated/projects/$projectId/automation/$automationId.tsx` | same | Apache-2.0 | Pattern only, no code copied. Rebuilt on Next.js, `@inflect/ui` and React Flow |

**If any file is translated closely** (an engineer works from Paca's source line by line, even across languages), treat it as a Derivative Work:

1. Keep the Apache License 2.0 text in the repository, for example `LICENSES/Apache-2.0.txt`. For **frontend** code, also ship it with the browser bundle on a third-party-licences page or asset, since the bundle is distributed (§4(a)).
2. Put a header at the top of each derived file (§4(b)):

   ```
   // Adapted from Paca (https://github.com/Paca-AI/paca), <source path>,
   // commit 5913718b6aaa81815085f1805dd764dbc5f55cce.
   // Copyright the Paca contributors. Licensed under the Apache License, Version 2.0
   // (see LICENSES/Apache-2.0.txt). Changed by Islestone: <one-line summary of changes>.
   ```

3. Add a `NOTICE` entry. Paca ships no `NOTICE`, so this is Islestone's own attribution, not a reproduced one:

   ```
   This product includes software adapted from Paca
   (https://github.com/Paca-AI/paca), commit 5913718b6aaa81815085f1805dd764dbc5f55cce,
   Copyright the Paca contributors, licensed under the Apache License, Version 2.0.
   A copy of the licence is in LICENSES/Apache-2.0.txt and at
   http://www.apache.org/licenses/LICENSE-2.0. Paca does not distribute a NOTICE
   file at that commit. Files adapted from Paca carry a header naming the source
   path and Islestone's changes.
   ```

4. "Copyright the Paca contributors" is the honest line. The licence names no holder, there is no CLA, and the README says no company owns the project. Do not write "© Paca", which implies an entity the tree does not show.

## 9. Open questions for the owner

1. **Pattern only or close translation?** This study recommends pattern only for both the engine and the UI. If close translation is chosen for frontend files, Islestone needs a shipped third-party-licences page (§8, step 1). Islestone has none today.
2. **Chain depth.** Should rules chain at all, and if so with what `MAX_CHAIN_DEPTH`? Paca forbids chaining entirely; roadmap 5.1 asks for a depth limit.
3. **Edits during a pause.** Pin the rule version on each execution (recommended) or let a paused execution resume into the edited graph, as Paca does.
4. **`predecessor_done`.** Derive it from `BLOCKS` relations, or keep an explicit watched list? And does `CANCELLED` count as done?
5. **Condition expressiveness.** Keep Paca's single leaf per branch, or reuse the saved-view filter expression (roadmap 2.4 and 7.3) so conditions and views share one evaluator and one AND/OR grammar?
6. **ADR 0006 amendment** naming the rule's node, edge and execution-step models before the first migration.
7. **React Flow attribution.** Keep the attribution, or hide it and subscribe to Pro?

## Licence check

**CONFIRMED.** I checked again on 2026-11-18 without relying on the earlier study. I read files and git metadata only. Nothing in the clone was run, installed or built, and the two restricted directories were counted by file name and never read.

| Check | Result |
|---|---|
| Pinned commit | The clone's `HEAD` is `5913718b6aaa81815085f1805dd764dbc5f55cce`, dated 2026-11-18 23:38:53 +0700 ("Merge pull request #783 …"). `git ls-remote https://github.com/Paca-AI/paca` reports the same SHA for `HEAD` and `refs/heads/master`, so the pin is the current tip of the upstream default branch. |
| `LICENSE` at the pin, fetched again | `https://raw.githubusercontent.com/Paca-AI/paca/5913718b6aaa81815085f1805dd764dbc5f55cce/LICENSE` returned HTTP 200: 11,357 bytes, sha256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`. It is byte-identical (`cmp`) to the clone's `LICENSE` (git blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`). A copy is saved at `scratchpad/oss-pins/paca-licence-check/LICENSE.raw`. |
| Licence text | I read the full file. It is the Apache License, Version 2.0, January 2004: §§1–9 plus the appendix. The appendix line `Copyright [yyyy] [name of copyright owner]` is unfilled, so the file names no copyright holder. It is byte-identical (same sha256) to the Apache-2.0 `LICENSE` that several npm packages ship in Islestone's own `node_modules` (`@eslint/core`, `@eslint/plugin-kit` and others), so it is the unmodified standard text. |
| Licence history | `git log -- LICENSE` shows one commit, `df9e7912` ("Add Apache License 2.0", 2026-03-20 10:40:42 +0700). That is the second commit, after `655a7970` "feat: initial commit" at 10:38:41. The file has not changed since. |
| Other licence or notice files | `git ls-files` finds no other file named LICENSE, COPYING, NOTICE, PATENTS, AUTHORS or COPYRIGHT. It finds no `ee/`, `enterprise/`, `pro/`, `vendor/`, `third_party/` or `licenses/` directory. So there is no `NOTICE`, and §4(d) carries nothing today. |
| SPDX and copyright headers | `git grep` (restricted directories excluded) finds no `SPDX-License` anywhere. The only copyright-like strings are UI copy: `footerCopyright` in `apps/web/src/i18n/locales/*/auth.json`, lines 37 and 149 in all 9 locales. |
| Copyleft or source-available text | Searched case-sensitively for AGPL, GPL, LGPL, BUSL, Elastic, SSPL, Sustainable Use, Commons Clause, MPL and PolyForm outside lockfiles. The only match is a comment in `scripts/install-paca-skills.sh` line 199 about macOS shipping bash 3.2, "the last GPLv2 release". That describes a tool, not a licence on Paca's code. |
| `package.json` licence fields | `apps/extension`: `"license": "Apache-2.0"`. `apps/mcp`: `"license": "Apache-2.0"`. `apps/web`, `apps/e2e` and `services/realtime` have no field, so the root `LICENSE` governs. There is no root `package.json`. The three Go modules (`apps/acp-bridge`, `services/agent-runner`, `services/api`) carry no licence field. |
| README and CONTRIBUTING | README line 12 is the Apache 2.0 badge. Line 75 reads "100% open-source (Apache 2.0)". Line 87 reads "Not a business. No company sells Paca". Lines 544–546 are "## License … Distributed under the **Apache License 2.0**". `CONTRIBUTING.md` line 21 promises that contributions "will not be relicensed into a closed or commercial edition". It has no CLA or DCO text. That promise binds the project, not downstream users. |
| Copyright holders | `git shortlog -sn HEAD`: pikann22 972, Hải Huỳnh 689, pikann 396, Mohammed Samiwala 174, copilot-swe-agent[bot] 137. This matches the study. |
| Third-party material | `apps/web/public/provider-logos/` holds 20 files. `services/api/internal/platform/bundledskills/content/` holds 22 files. I did not read either. Their stated origins are in non-restricted files. `apps/web/src/lib/provider-logos.ts` lines 8 and 38 say the logos are "sourced from @lobehub/icons-static-svg, MIT licensed". `docs/ai-agent/default-skills.md` line 46 and `bundledskills_test.go` line 276 name `mattpocock/skills`. Neither upstream licence was verified, which matches the study. |
| Stack pins in the licence section | `apps/web/bun.lock` pins `@xyflow/react` 12.11.1, `@xyflow/system` 0.0.78 and `@blocknote/{core,react,shadcn}` 0.48.1. It has no `xl-*` package. This matches the study. |

**Detail added, not a correction.** The study says `bun.lock` carries no licence fields. That is true of all four `bun.lock` files. But `apps/extension/package-lock.json` does carry licence fields, and it lists 12 MPL-2.0 dev dependencies: `lightningcss` and its platform binaries. They are third-party packages, not Paca code, and do not change Paca's own licence. I noted them in "Not verified" above.

**Not verifiable here.** I could not use the GitHub API's licence detection for the repository, because this session's GitHub access does not cover it (HTTP 403). The raw-file fetch above stands in for it.
