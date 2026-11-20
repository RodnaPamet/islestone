# 0002 — Work item model

Status: Accepted (owner decisions, 2026-11-19; amended by owner decisions 100 to 119, 2026-11-20: field sets in §1 and §7, waiting on in §14, the marked answer in §15)

## Context

Roadmap principle 3 says Islestone has one work-item table, and that views, cycles, milestones and roadmaps are scopes over it. Roadmap 2.1 builds the core: teams, projects, work items, types, workflow states, relations, labels and per-project keys. Roadmap 2.2 adds versioning and encryption; 2.4 adds custom fields; 3.2 adds goals and initiatives.

This ADR fixes the shape of that model before 2.1 writes it. It uses the words in ADR 0006. Column names follow that ADR's recommended option W1 (`tenantId`); if the owner chooses W2, they become `workspaceId` and nothing else here changes. The schema sketch below is illustrative, not final.

This ADR was drafted on 2026-11-18. The repository owner decided its open questions in the working session on 2026-11-19: search titles, keys and unencrypted fields until a search ADR chooses (S1, section 11); an in-house fractional index (F1, section 5); a 30-day soft-delete window (section 8); depth caps of 5 and 3 (section 2); and moving a sub-item on its own to another project is refused (section 2). Each records the owner's choice where it is made.

How to read this ADR: a line marked **Verified** was read in the named file on 2026-11-18. A line marked **Decision** records an owner decision of 2026-11-19. Everything else is the design this ADR fixes, or is labelled as an inference.

### What inflect-compliance's task engine does

Read at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`, for their design; nothing was copied. ADR 0001 D1 (owner decision, 2026-11-18) now allows copying inflect-compliance code, with a `PROVENANCE.md` row for every copied file.

- **Verified.** One `Task` table with fixed enums for type, severity, priority, status and source (`prisma/schema/tasks.prisma` lines 5–45; `prisma/schema/enums.prisma` lines 409–503). Types are compliance kinds such as `AUDIT_FINDING` and `CONTROL_GAP`. Nothing is configurable per tenant.
- **Verified.** Status is a fixed eight-value enum with an explicit transition table. `CLOSED` and `CANCELED` are terminal: nothing moves out of them (`src/app-layer/domain/task-status.ts` lines 116–138). The check is a pure function that returns `null` or a discriminated error (`no_op`, `illegal`, `unknown_from`, `unknown_to`), and refusal messages use display names (lines 140–215).
- **Verified.** Keys are `TSK-N`, unique per tenant (`@@unique([tenantId, key])`, `tasks.prisma` line 64). The number comes from a per-tenant counter, `TaskKeySequence`, incremented with an atomic upsert that compiles to `INSERT … ON CONFLICT DO UPDATE` (`tasks.prisma` lines 100–114; `src/app-layer/repositories/TaskRepository.ts` lines 626–638). It replaced a `count()` that raced the unique index.
- **Verified.** Parent tables declare `@@unique([id, tenantId])`, and child tables reference `[taskId, tenantId]`. The reason is recorded: Postgres runs foreign-key checks as the table owner, which bypasses RLS, so a single-column child key leaves a cross-tenant reference representable (`tasks.prisma` lines 92–97, issue #2356).
- **Verified.** Links to other records go through `TaskLink`, with relations such as `RELATES_TO` and `BLOCKED_BY` (`tasks.prisma` lines 116–130; `enums.prisma` lines 518–524). A `TaskLink` points from a task to another kind of record, not task to task. A search of the task usecases and `TaskRepository.ts` found no cycle check.
- **Verified.** Checklists live in one JSON column. The repository notes that ticking an item is a read-modify-write of the whole array, so two concurrent ticks lose one, and it reads the row `FOR UPDATE` to stop that (`TaskRepository.ts` lines 693–699).
- **Verified.** `Task` has no version column. The process-map model has one. Its schema comment says it is "NOT yet enforced as a hard optimistic lock" (`prisma/schema/processes.prisma` lines 54–60), but that comment is stale: `ProcessMapRepository.replaceGraph` does enforce the version whenever the caller sends `expectedVersion`, refusing a mismatch before the write and again with a conditional update (`src/app-layer/repositories/ProcessMapRepository.ts` lines 287–297, 375–384, 581–632). Omitting `expectedVersion` means last-write-wins. ADR 0005 ("What inflect-compliance has built") records the same reading.
- **Verified.** Soft delete uses `deletedAt` and `deletedByUserId` (`tasks.prisma` lines 43–44). An allowlist of models gets it through a Prisma extension (`src/lib/soft-delete.ts` lines 12–33). The extension filters only the top-level model, so nested counts must add `deletedAt: null` themselves (`TaskRepository.ts` lines 597–605).
- **Verified.** Field encryption is driven by a manifest. `Task.description`, `Task.resolution` and `TaskComment.body` are in it; `title` is not, because the repository searches `title` and `key` only (`src/lib/security/encrypted-fields.ts` lines 292–296).
- **Verified.** No fractional indexing, rank or lexorank appears in its `src/`, `prisma/` or `docs/`.

## Decision

### 1. One table, configurable types

Every kind of work is a row in `WorkItem`. Its kind is a `WorkItemType` row that each workspace configures (name, icon, colour, sort key, archived). A type carries one behaviour, its field set (below); otherwise any type may parent any type, and every type uses its team's workflow. A workspace seeds default types at creation (ADR 0006, open question 6).

Why rows, not an enum: types are customer data, and an enum change is a migration and a two-deploy rollout.

**Field sets** (roadmap 2.4b; owner decisions 77 and 108 to 112, 2026-11-20). For each type, a field set says which fields are required, optional or hidden. It is the type's `WorkItemTypeField` rows; a field with no row is optional, except the answer (§15), which is hidden.

- The configurable built-in fields are description, assignee, waiting on (§14), priority (required means not None), labels (at least one), start date, due date, cycle, milestone and the answer (shown or hidden only). Title, type, project and state are always required.
- A built-in field's rule belongs to the type across the workspace and is managed under `admin.manage`. A custom field's rule belongs to the type within the field's project (§7) and is managed under `projects.edit`.
- The usecases enforce it. A create, or a write to an open item, that leaves a required field empty is refused, naming the fields; a write that sets a hidden field is refused, and a hidden field a template brings is skipped and named. A closed item is never refused for a missing field. A type change is checked against the new type's whole set. A new or tightened rule does not rewrite existing items; their gaps are shown.
- Items the system makes (a template's sub-items, a project template's starter items, a repeat's copies) are checked like any create; a refused repeat is held with its reason.
- Every form reads the rules from the server and evaluates them with the same function the usecases use. Agent proposals are checked against them when made and when approved (roadmap 6.2).
- Types carry no other behaviour: per-type workflows, parent rules or review steps would each be a new decision.

### 2. The parent chain

The chain is goal → initiative → project → work item → sub-item.

| Link | How it is stored | Why |
|---|---|---|
| Goal → Goal | `Goal.parentId` (nullable) | Goals nest (company goal, team goal). Same model, same fields. |
| Goal → Initiative | `Initiative.goalId` (nullable) | Different model: an initiative groups projects across teams and has its own lifecycle. |
| Initiative → Project | `Project.initiativeId` (nullable) | Different model: a project owns a key prefix, custom fields and a team. |
| Project → Work item | `WorkItem.projectId` (required) | Every item needs a project, because the key comes from the project. |
| Work item → Sub-item | `WorkItem.parentId` (nullable) | Same table. A sub-item is a work item with the same fields, type system, states and key. |

Rules:

- **Each link is single-parent.** So every item has exactly one ancestry, and "why does this exist" has one answer (roadmap 2.2, idea 2). A many-to-many link would make ancestry a set.
- **A sub-item is in the same project as its parent**, held by a composite foreign key (see section 10). This keeps the ancestry unique and the key prefix meaningful. Moving a parent to another project moves its subtree in the same transaction.
- **Moving a sub-item on its own to another project is refused.** It would leave its parent. A sub-item moves to another project only with its parent's subtree (the rule above). **Decision:** owner decision, 2026-11-19 (open question 5); the owner chose "Accept all", accepting this ADR's recommendation.
- **Depth is capped**, so the ancestry query is bounded: 5 levels of sub-items, 3 levels of goals. The usecase refuses a write past the cap. **Decision:** owner decision, 2026-11-19 (open question 4); the owner chose "Accept all", accepting the recommended caps.
- **No cycles in `parentId`.** Re-parenting runs the same locked check as blocking relations (section 6).
- **Ancestry is one query**: a recursive common table expression up `WorkItem.parentId`, then joins to project, initiative and the goal chain (roadmap 3.2).
- Cycles and milestones are scopes, not ancestors. An item has at most one of each (`cycleId`, `milestoneId`).

### 3. Teams, workflow states and categories

- A **team** owns its workflow: an ordered list of `WorkflowState` rows.
- Every state has one **category**: `BACKLOG`, `UNSTARTED`, `STARTED`, `DONE` or `CANCELLED` (ADR 0006 spelling). The category is a Postgres enum, because the set is fixed by the product.
- **A state's category never changes after creation.** To recategorise, create a new state and move the items. This is what lets `WorkItem` carry a denormalised `stateCategory` that a foreign key keeps correct (section 10).
- Each team has exactly one default state for new items, and at least one `DONE` and one `CANCELLED` state. Marking a duplicate and closing a cycle need them.
- A state with items cannot be deleted. The usecase asks where to move them; the foreign key is `RESTRICT` as the backstop.
- A project belongs to one team, and its items use that team's states.

**Transitions.** The check is a pure function in the domain layer, in the pattern of `task-status.ts`: it returns `null` or a discriminated error, and messages use the states' display names. Pattern only, no code copied. The rules differ from the parent product's:

- Any state may move to any other state of the same team. Teams in project-management tools reopen and reshuffle work freely; inflect-compliance's terminal statuses served audit coherence, which Islestone does not need.
- Refused: a no-op, a state of another team, an archived state.
- Effects, returned by the same function so every caller applies them alike:
  - first move into `STARTED` sets `startedAt`;
  - a move into `DONE` sets `completedAt`; into `CANCELLED` sets `cancelledAt`;
  - a move out of `DONE` or `CANCELLED` clears that timestamp (reopen);
  - a move into `DONE` or `CANCELLED` ends a live agent session on the item (ADR 0003).
- Per-team transition rules, if ever needed, are new rows read by the same function. No reviewer gate in this ADR.
- **Adding a category later is a two-deploy change.** A Prisma client that meets an enum value it was not generated with fails the whole read, so the first deploy teaches every reader and the second writes the value. This is recorded in inflect-compliance's `CLAUDE.md` ("Agent recertification", the two-deploy rollout of `AccessReviewScope`).

### 4. Keys: `ISL-123`

- A key is the project's current prefix, a hyphen and the item's number. The number is stored (`WorkItem.number`); the key string is not.
- **Numbers come from `ProjectKeySequence`**, one row per project, incremented atomically in the same transaction as the insert. This is the `TaskKeySequence` pattern scoped to a project. Pattern only, no code copied. Because it is the same transaction, a failed create does not use up a number. Concurrent creates in one project wait on that row until commit; that is accepted.
- `@@unique([tenantId, projectId, number])` covers deleted rows too. **Numbers are never reused.**
- **Prefixes are unique per workspace and never reused.** A project can change its prefix. Every prefix it has had stays in `ProjectKeyPrefix`, so old keys in commit messages and links still resolve (roadmap 5.3 links by key).
- **An item that moves to another project gets a new number there.** Its old key is kept in `WorkItemKeyAlias`. Old numbers cannot collide with new ones, because sequences only increase.
- Importers (roadmap 5.5) may keep source keys. They set numbers explicitly and raise the sequence to at least the highest imported number in the same transaction.

### 5. Ordering by fractional index

- Each item has one `sortKey` string. Ordering is `(sortKey, id)`: the id breaks ties.
- One key serves every list. A board column, a sub-item list and a filtered list are all the items in `sortKey` order. A drop places the item between its two visible neighbours.
- **The server computes the key.** The client sends "after X, before Y" by id; the server reads the current keys and writes one between them. The client may show its own key optimistically, as roadmap 0.2 item 5 describes (server-authoritative data with optimistic UI).
- **The column uses the `"C"` collation**, so Postgres compares bytes. Under a language collation, mixed-case keys sort in a different order than they were generated. Prisma cannot declare a column collation, so it goes in the migration SQL with a database-backed test that reads the catalogue. JavaScript compares keys with `<`, never `localeCompare`.
- Keys grow when many inserts land in the same gap. A job rebalances a project's keys when any key passes a length bound (recommended: 64 characters).
- **`sortKey` is not part of the item's version** (section 9). Order belongs to the list. Live updates (roadmap 4.3) report order changes as their own message.
- **Every manually ordered list uses the same column, `sortKey`, under the same rules:** work item types, workflow states, milestones, custom fields and their options. One name and one implementation, so the collation and the rebalance apply to all of them.
- Implementation:
  - **F1. In-house pure module with property tests.** The algorithm is small and well described in public writing. **Decision: F1.** Owner decision, 2026-11-19 (open question 1); the owner chose "Accept all", accepting the recommendation.
  - **F2. The `fractional-indexing` package.** Not chosen. **Verified** on the npm registry on 2026-11-18: version 4.0.0, licence `CC0-1.0`. CC0 is not on roadmap 0.3's allowlist, nor on the licence gate's (`scripts/licence-gate.mjs`), so F2 would have needed CC0-1.0 added (ADR 0007, E4) or a recorded exemption.

### 6. Relations

`WorkItemRelation` has `fromId`, `toId` and a type.

| Type | Meaning | Stored as |
|---|---|---|
| `BLOCKS` | `from` must finish before `to` can. "Blocked by" is the reverse read. | One row per edge. |
| `RELATES` | Symmetric. | One row, with `fromId < toId` (a CHECK), so a pair cannot be stored twice. |
| `DUPLICATES` | `from` is a duplicate of `to`. | One row. An item duplicates at most one item (partial unique index). The target may not itself be a duplicate, so there are no chains and no cycles. Marking a duplicate moves the item to a `CANCELLED` state. |

Common rules: a CHECK refuses `fromId = toId`; `@@unique([tenantId, type, fromId, toId])`; relations may cross projects inside one workspace; composite foreign keys keep both ends in the same tenant.

**Cycle refusal for `BLOCKS`:**

- The usecase refuses an edge `A blocks B` when `B` already reaches `A` through `BLOCKS` edges. The check is a recursive query with `UNION` (not `UNION ALL`), so it ends on any graph.
- **Two concurrent inserts can each pass the check and together close a cycle** under READ COMMITTED. So every write to the blocking graph or to `parentId` first takes a transaction-level advisory lock on a namespaced key, `work-item-graph:<tenantId>`. inflect-compliance fixed the same race for last-owner checks this way (`src/app-layer/usecases/tenant-owner-lock.ts` lines 1–30); its comment also notes that the key needs a namespace so it does not collide with other locks on the same tenant. Pattern only, no code copied. Graph writes are rare, so one lock per workspace is acceptable.
- The check walks every `BLOCKS` edge, including edges to soft-deleted items. No relation may be created to or from a soft-deleted item. Together these make restoring an item unable to create a cycle.
- Roadmap 2.1 requires a property test: over random sequences of inserts, the accepted edges never contain a cycle, and an insert is accepted exactly when it keeps the graph acyclic.
- Importers report source cycles in the dry run and skip those edges.

### 7. Custom fields as typed values

- `CustomField` belongs to a project (roadmap 2.4): name, type, sort key, archived. Types: `TEXT`, `NUMBER`, `SELECT`, `MULTI_SELECT`, `DATE`, `PERSON`, `URL`, `CHECKBOX`.
- `CustomFieldOption` holds the choices of a select field, each with a `name` and a sort key.
- `CustomFieldValue` holds one value in a typed column: `textValue`, `numberValue` (decimal), `dateValue` (date), `boolValue`, `optionId` (foreign key), `userId` (foreign key to a member).
  - The value row repeats the field's type. A composite foreign key to `CustomField(id, type)` keeps it right, and a CHECK requires exactly the matching column to be set.
  - One row per item and field. A multi-select stores one row per chosen option. Two partial unique indexes keep both shapes exact.
  - `TEXT` and `URL` values are capped (recommended: 500 characters) so they fit a B-tree index.
- **Why not a JSON blob:**
  - filters and sorts need typed comparisons and ordinary indexes;
  - options and people need foreign keys, or a deleted option leaves values that point at nothing;
  - a JSON column is a read-modify-write of the whole object, which loses concurrent edits, as inflect-compliance's checklist shows (`TaskRepository.ts` lines 693–699).
- **Text values are not encrypted**, because they are filterable. The field editor says so. Long or sensitive text belongs in the description.
- A project's custom field may be required, optional or hidden for each work item type, in that project only (§1, field sets; owner decision 108). The rule goes with the field, the type or the project. An archived field is never required.

### 8. Soft delete

- `WorkItem` has `deletedAt`, `deletedByUserId` and `deletionId`. Deleting an item soft-deletes its sub-items in the same transaction with the same `deletionId`, so a restore brings back exactly what was deleted together.
- Reads filter `deletedAt IS NULL` explicitly in the repository, including nested reads and counts. A global extension misses nested reads (the inflect-compliance finding above); a test checks the repository's queries.
- Deleted rows keep their number, relations and comments. They are hidden from lists, search, the scheduler and agents.
- A restore is refused while the item's project is deleted.
- A purge job hard-deletes after a retention window of **30 days**, during which deleted items sit in a visible trash. inflect-compliance purges its soft-deleted models after 90 days (its `CLAUDE.md`, "Data Retention"). **Decision:** 30 days, owner decision, 2026-11-19 (open question 3); the owner chose "Accept all", accepting the recommendation.

### 9. Optimistic concurrency

- `WorkItem.version` starts at 1. **Every write that changes what the item shows increases it**, including labels and custom-field values. `sortKey` is the one exception (section 5).
- Writes carry the expected version in an `If-Match` header. The usecase updates with `WHERE id = ? AND tenantId = ? AND version = ?`. If no row matched, it re-reads: no row is a 404; a row with another version is a **409** with the current version and row.
- **Whether `If-Match` is required depends on the write:**
  - Required for title, description and any multi-field form save. These carry typed work a person would lose.
  - Optional for single-field changes: state, assignee, waiting on, delegate, priority, labels, cycle, milestone, the answer, one custom field. Without it, the last writer wins for that field, and the change is audited.
  - Bulk updates (roadmap 2.2) are single-field changes over many items. They take no versions and increase each item's version.
- **The client resolves most conflicts itself.** On a 409 it compares the fields it changed with the current row. If none of them changed underneath it, it retries with the new version. Only a real same-field conflict reaches the person. This gives field-level behaviour with one column.
- Agent proposals that update an item record the version and field values they were based on, and approval applies the same rule (ADR 0003).

### 10. Tenancy and integrity

- Every table in this ADR has `tenantId`, a tenant-leading index, RLS policies in the migration that creates it, and a two-tenant test (roadmap section 4).
- Every parent declares `@@unique([id, tenantId])`. Every child references its parent through a composite key that includes `tenantId`, for the reason inflect-compliance recorded (section "What inflect-compliance's task engine does"). Pattern only, no code copied.
- **Composite keys also make wrong shapes unrepresentable:**
  - `(projectId, teamId)` → `Project(id, teamId)`: an item's team is its project's team;
  - `(stateId, teamId, stateCategory)` → `WorkflowState(id, teamId, category)`: a state of another team, or a stale category, cannot be stored;
  - `(cycleId, teamId)` → `Cycle(id, teamId)`: a cycle of another team cannot be stored;
  - `(milestoneId, projectId)` → `Milestone(id, projectId)`: a milestone of another project cannot be stored;
  - `(parentId, projectId)` → `WorkItem(id, projectId)`: a parent in another project cannot be stored;
  - `(tenantId, waitingOnUserId)` → `TenantMembership(tenantId, userId)`: only a member can be waited on; RESTRICT, cleared by member removal as the assignee is (§14);
  - `(answerCommentId, id)` → `Comment(id, workItemId)`: an answer is a comment of the same item (§15).
  - Each also includes `tenantId`.
- The parent link is `DEFERRABLE INITIALLY DEFERRED`, so a move can update a parent and its sub-items in one transaction. Prisma cannot declare that, so it goes in the migration SQL with a catalogue test.
- **Moves.** Moving an item to a project of another team maps its state to the new team's default state of the same category, and clears its cycle. Moving to another project clears its milestone. Both are one usecase.
- Every mutation is validated with Zod, authorised with `requirePermission`, sanitised where it takes free text, and audited with `logEvent` (roadmap section 4).

### 11. Encryption

- `WorkItem.description` and `Comment.body` are in the field-encryption manifest (roadmap 2.2), as their counterparts are in inflect-compliance.
- `title` stays plaintext. It is searched, shown in notifications, and quoted in commit messages and calendar events.
- Audit entries for an encrypted field record that it changed, not its text. The Activity view shows "edited the description" and fetches the current text through the authorised API.
- **Consequence for search.** Postgres full-text search and pgvector (roadmap 2.7 and 6.5) need plaintext or something derived from it. Options:
  - **S1. Search titles, keys and unencrypted fields only.** inflect-compliance's choice. Keeps encryption whole; search is weaker.
  - **S2. Store a search index derived from the plaintext** (a `tsvector` or embeddings). Full search, but the derived data reveals the words or meaning of the encrypted text, and it must itself be protected by RLS and excluded from exports.
  - **S3. Store keyed hashes of normalised words**, keyed per workspace. Exact-word search without readable words; no ranking by prefix or meaning.
  - **S4. Do not encrypt descriptions and comments.** Simplest; drops roadmap 2.2's requirement.
  - **Decision: S1 now; a search ADR chooses between S2 and S3 later.** Owner decision, 2026-11-19 (open question 2); the owner chose "S1 now, decide later". This is the recommendation. Until that ADR, search covers titles, keys and unencrypted fields only. The search ADR is due before roadmap 2.7, because 2.7 asks for full-text search over items and comments, and comment bodies are encrypted: under S1 alone, comments cannot be searched. Embeddings (6.5) are S2 by nature, so 6.5 needs that decision too. S4 was not chosen: descriptions and comments stay encrypted.
  - **Superseded for descriptions and comments by [ADR 0008](0008-search-over-encrypted-fields.md)** (owner decisions 124 to 126, 2026-11-20). The owner chose S2: a plaintext `tsvector` full-text index (Bulgarian and English stemming, one custom configuration) over `WorkItem.description` and `Comment.body`, kept in `SearchVector` and written by the usecase in the text's own transaction; titles and keys get Postgres full-text and trigram indexes. The searchable words of descriptions and comments are therefore readable in the database, its dumps and its off-host backups; the text itself stays encrypted. Every other encrypted or personal field stays out of search (ADR 0008 lists them). Embeddings (6.5) and pages (4.1) need their own amendment to ADR 0008.

### 12. Schema sketch (illustrative, not final)

Relations, `@relation` lines and most `createdAt`/`updatedAt` columns are left out. Comments show the composite foreign keys.

```prisma
enum WorkflowStateCategory { BACKLOG UNSTARTED STARTED DONE CANCELLED }
enum WorkItemPriority      { NONE URGENT HIGH MEDIUM LOW }
enum WorkItemRelationType  { BLOCKS RELATES DUPLICATES }
enum CustomFieldType       { TEXT NUMBER SELECT MULTI_SELECT DATE PERSON URL CHECKBOX }

model Goal {
  id          String    @id @default(cuid())
  tenantId    String
  parentId    String?                  // goals nest; capped depth
  title       String
  targetDate  DateTime? @db.Date
  health      String?                  // set by a person (roadmap 3.2)
  @@unique([id, tenantId])
  @@index([tenantId, parentId])
}

model Initiative {
  id        String  @id @default(cuid())
  tenantId  String
  goalId    String?
  name      String
  @@unique([id, tenantId])
  @@index([tenantId, goalId])
}

model Team {
  id        String @id @default(cuid())
  tenantId  String
  name      String
  @@unique([id, tenantId])
  @@unique([tenantId, name])
}

model Project {
  id            String    @id @default(cuid())
  tenantId      String
  teamId        String
  initiativeId  String?
  name          String
  keyPrefix     String                 // current prefix; history in ProjectKeyPrefix
  version       Int       @default(1)
  archivedAt    DateTime?
  deletedAt     DateTime?
  @@unique([id, tenantId])
  @@unique([id, teamId, tenantId])     // target of WorkItem's composite FK
  @@index([tenantId, teamId])
  @@index([tenantId, initiativeId])
}

model ProjectKeyPrefix {               // every prefix ever used; never reused
  tenantId   String
  prefix     String
  projectId  String
  retiredAt  DateTime?
  @@id([tenantId, prefix])
  @@index([tenantId, projectId])
}

model ProjectKeySequence {
  projectId  String @id
  tenantId   String
  lastValue  Int    @default(0)
  @@index([tenantId])
}

model WorkItemType {
  id         String    @id @default(cuid())
  tenantId   String
  name       String
  sortKey    String                    // fractional index (section 5)
  archivedAt DateTime?
  @@unique([tenantId, name])
  @@unique([id, tenantId])
}

model WorkflowState {
  id         String                @id @default(cuid())
  tenantId   String
  teamId     String
  name       String
  category   WorkflowStateCategory  // immutable after create
  sortKey    String                 // fractional index within the team (section 5)
  isDefault  Boolean               @default(false)
  archivedAt DateTime?
  @@unique([tenantId, teamId, name])
  @@unique([id, teamId, category, tenantId])   // target of WorkItem's composite FK
  @@index([tenantId, teamId, sortKey])
}

model Cycle {
  id        String   @id @default(cuid())
  tenantId  String
  teamId    String
  number    Int
  startsOn  DateTime @db.Date
  endsOn    DateTime @db.Date
  @@unique([tenantId, teamId, number])
  @@unique([id, teamId, tenantId])
}

model Milestone {
  id          String    @id @default(cuid())
  tenantId    String
  projectId   String
  name        String
  targetDate  DateTime? @db.Date
  sortKey     String
  @@unique([id, projectId, tenantId])
  @@index([tenantId, projectId, sortKey])
}

model WorkItem {
  id               String                @id @default(cuid())
  tenantId         String
  teamId           String                // = project's team. FK (projectId, teamId, tenantId) -> Project
  projectId        String
  number           Int                   // key = Project.keyPrefix + "-" + number
  typeId           String                // FK (typeId, tenantId) -> WorkItemType
  title            String                // plaintext
  description      String?               // encrypted (manifest)
  stateId          String                // FK (stateId, teamId, stateCategory, tenantId) -> WorkflowState
  stateCategory    WorkflowStateCategory  // denormalised; held by that FK
  priority         WorkItemPriority      @default(NONE)
  assigneeId       String?               // a member (ADR 0003)
  delegateAgentId  String?               // an agent (ADR 0003); added with the Agent table in roadmap 6.3
  createdByUserId  String
  parentId         String?               // FK (parentId, projectId, tenantId) -> WorkItem, DEFERRABLE
  cycleId          String?               // FK (cycleId, teamId, tenantId) -> Cycle
  milestoneId      String?               // FK (milestoneId, projectId, tenantId) -> Milestone
  sortKey          String                // fractional index, COLLATE "C" (migration SQL)
  estimate         Decimal?
  startDate        DateTime?             @db.Date
  dueDate          DateTime?             @db.Date
  startedAt        DateTime?
  completedAt      DateTime?
  cancelledAt      DateTime?
  version          Int                   @default(1)
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
  deletedAt        DateTime?
  deletedByUserId  String?
  deletionId       String?

  @@unique([tenantId, projectId, number])
  @@unique([id, tenantId])
  @@unique([id, projectId, tenantId])   // target of parentId's composite FK
  // list indexes: see section 13
}

model WorkItemKeyAlias {               // old keys of items that moved project
  tenantId    String
  projectId   String
  number      Int
  workItemId  String
  @@id([tenantId, projectId, number])
  @@index([tenantId, workItemId])
}

model WorkItemRelation {
  id        String               @id @default(cuid())
  tenantId  String
  type      WorkItemRelationType
  fromId    String               // FK (fromId, tenantId) -> WorkItem
  toId      String               // FK (toId, tenantId) -> WorkItem
  createdByUserId String
  @@unique([tenantId, type, fromId, toId])
  @@index([tenantId, type, toId])
  // CHECK fromId <> toId; CHECK type <> 'RELATES' OR fromId < toId;
  // partial unique (tenantId, fromId) WHERE type = 'DUPLICATES'
}

model Label {
  id        String  @id @default(cuid())
  tenantId  String
  teamId    String?                    // null = workspace-wide
  name      String
  @@unique([id, tenantId])
  @@index([tenantId, teamId])
}

model WorkItemLabel {
  tenantId    String
  workItemId  String
  labelId     String
  @@id([workItemId, labelId])
  @@index([tenantId, labelId, workItemId])
}

model CustomField {
  id         String          @id @default(cuid())
  tenantId   String
  projectId  String
  name       String
  type       CustomFieldType
  sortKey    String
  archivedAt DateTime?
  @@unique([tenantId, projectId, name])
  @@unique([id, type, tenantId])       // target of the value's composite FK
}

model CustomFieldOption {
  id        String @id @default(cuid())
  tenantId  String
  fieldId   String
  name      String
  sortKey   String
  @@unique([id, tenantId])
  @@index([tenantId, fieldId, sortKey])
}

model CustomFieldValue {
  id          String          @id @default(cuid())
  tenantId    String
  workItemId  String
  fieldId     String          // FK (fieldId, fieldType, tenantId) -> CustomField
  fieldType   CustomFieldType
  textValue   String?         // TEXT, URL; capped length
  numberValue Decimal?
  dateValue   DateTime?       @db.Date
  boolValue   Boolean?
  optionId    String?         // SELECT, MULTI_SELECT
  userId      String?         // PERSON
  @@index([tenantId, workItemId])
  @@index([tenantId, fieldId, numberValue])
  @@index([tenantId, fieldId, dateValue])
  @@index([tenantId, fieldId, optionId])
  @@index([tenantId, fieldId, userId])
  @@index([tenantId, fieldId, textValue])
  // CHECK: exactly the column matching fieldType is set.
  // partial unique (workItemId, fieldId) WHERE fieldType <> 'MULTI_SELECT';
  // partial unique (workItemId, fieldId, optionId) WHERE fieldType = 'MULTI_SELECT'
}

model Comment {
  id            String    @id @default(cuid())
  tenantId      String
  workItemId    String    // roadmap 4.1 adds pageId; a CHECK then requires exactly one parent
  authorUserId  String
  body          String    // encrypted (manifest); sanitised on write
  editedAt      DateTime?
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  @@index([tenantId, workItemId, createdAt])
}

model WorkItemWatcher {
  tenantId    String
  workItemId  String
  userId      String
  @@id([workItemId, userId])
  @@index([tenantId, userId])
}

model WorkItemLink {
  id          String @id @default(cuid())
  tenantId    String
  workItemId  String
  kind        String   // URL, PULL_REQUEST, COMMIT, PAGE, CANVAS; validated in the usecase
  target      String
  @@index([tenantId, workItemId])
}
```

### 13. Indexes for list queries

Each index backs a named query. H2 measures them on seeded tenants at 10,000 and 100,000 items; an index no query uses is removed. All are tenant-leading.

| Query | Index on `WorkItem` |
|---|---|
| Project list, manual order, cursor pagination | `[tenantId, projectId, sortKey, id]` |
| Board columns by state | `[tenantId, projectId, stateId, sortKey]` |
| Team backlog across projects, by category | `[tenantId, teamId, stateCategory, sortKey]` |
| My Work: assigned to me and open, by due date | `[tenantId, assigneeId, stateCategory, dueDate]` |
| Waiting on: the filter, its lanes and My Work's "waiting on me" (2.7) | `[tenantId, waitingOnUserId, stateCategory, dueDate]` |
| Items delegated to an agent | `[tenantId, delegateAgentId, stateCategory]` |
| Cycle page and burn-up | `[tenantId, cycleId, stateCategory]` |
| Milestone page | `[tenantId, milestoneId, stateCategory]` |
| Sub-items of an item | `[tenantId, parentId, sortKey]` |
| Created by me | `[tenantId, createdByUserId, createdAt]` |
| Recently changed (activity, live-update catch-up) | `[tenantId, projectId, updatedAt, id]` |
| Due-date reminder job | `[tenantId, stateCategory, dueDate]` |
| Filter by type | `[tenantId, typeId]` |
| Key lookup | `@@unique([tenantId, projectId, number])` |
| Purge sweep across all workspaces | `[deletedAt]`, the one index that is not tenant-leading, because the sweep runs over every workspace. inflect-compliance makes the same exception for its proposal-expiry sweep (`prisma/schema/agentic.prisma` lines 231–236). |

Other tables: labels by `[tenantId, labelId, workItemId]`; relations by `[tenantId, type, fromId, toId]` (unique) and `[tenantId, type, toId]`; custom values by `[tenantId, fieldId, <value column>]`; comments by `[tenantId, workItemId, createdAt]`. Every foreign-key column is indexed, alone or as the second column after `tenantId`.

List queries also filter `deletedAt IS NULL`. If the pinned Prisma version cannot declare partial indexes, the list indexes above are written as partial indexes in migration SQL, and the index guardrail (H2) reads the database catalogue rather than only the schema file.

### 14. Waiting on

- `WorkItem.waitingOnUserId` names at most one active member who must act next (roadmap 2.4b; owner decisions 76 and 103 to 107, 2026-11-20). It never makes anyone or anything accountable: the assignee stays the one accountable person (ADR 0003 §1, unchanged), and nothing routes reminders, delegation or proposals by it until a later sub-phase says so. The person named gets one in-app notification when someone else names them.
- It is set by a person under `work_items.edit`, as a single-field change (§9); roadmap 2.8's review steps will set it too, and a repeat copy takes its source's.
- **From roadmap 6.3 it may name the delegate's agent session instead of a member** (owner decision 106). 6.3 adds a nullable session reference beside `waitingOnUserId`, with a CHECK that at most one of the two is set, and widens the closed-item CHECK below to both. The member column keeps its name and its data; nothing is rewritten.
- It is cleared by every move into `DONE` or `CANCELLED`: `stateTransitionEffects` returns the clear, so every state path applies it, and a CHECK refuses a closed item that names one. A reopen does not restore it.
- Each change is recorded in `WorkItemTransition`, so time waiting is counted from recorded changes (roadmap 3.6; owner decision 107).

### 15. Marked answer

- `WorkItem.answerCommentId` points at one live comment of the same item (roadmap 2.4b; owner decisions 78 and 113 to 118, 2026-11-20). A person who may edit the item marks it, never an API key or an agent; marking moves an open item to the team's first live `DONE` state (a chooser when there are several) in the same versioned write. Marking or clearing the answer of a closed item changes only the pointer, and clearing never reopens.
- It is offered only where the item's field set shows the answer (§1). While a comment is the marked answer, deleting and editing it are refused until the answer is cleared; an admin moderates by clearing, then deleting.

### Open questions for the owner

All five were answered on 2026-11-19 in the working session.

1. Answered: fractional-index implementation. F1, in-house, with property tests (section 5). The owner chose "Accept all".
2. Answered: search versus encryption. S1 now; a search ADR, due before roadmap 2.7, chooses between S2 and S3 (section 11). The owner chose "S1 now, decide later". ADR 0008 (2026-11-20) chose S2 for descriptions and comments.
3. Answered: soft-delete retention window. 30 days (section 8). The owner chose "Accept all".
4. Answered: depth caps. 5 levels of sub-items, 3 levels of goals (section 2). The owner chose "Accept all".
5. Answered: moving a sub-item on its own to another project is refused (section 2). The owner chose "Accept all".

## Consequences

- One work-item table carries every kind of work, so views, cycles, milestones and roadmaps are filters over it (principle 3). A new kind of work is a type row, not a migration.
- Every item belongs to a project. A workspace that wants loose items needs a project for them; templates (roadmap 2.5) should create one by default.
- Sub-items cannot live in another project. Cross-project breakdowns use `BLOCKS` or `RELATES` relations.
- The denormalised `teamId` and `stateCategory` make the list indexes possible and wrong combinations unstorable. In exchange, moves are usecases, a state's category is fixed, and Prisma's generated types show columns a developer must not set by hand.
- Several guarantees live in migration SQL that Prisma cannot express: the `"C"` collation, a deferrable foreign key, CHECKs, partial unique indexes. Each needs a database-backed test, in the style of the RLS coverage guardrail.
- One advisory lock per workspace serialises blocking-graph and re-parenting writes. A very large import must batch those writes.
- `If-Match` on text edits means clients must handle 409. The automatic retry keeps most conflicts invisible.
- Description and comment encryption limited search (section 11) until ADR 0008 (2026-11-20) chose a plaintext full-text index over both, at the cost stated there.
- Custom text values are filterable and therefore not encrypted.
- **An intake request is not a work item** (owner decision 85, 2026-11-20; roadmap 2.6). Requests from forms and email wait in their own table, `IntakeRequest`, outside `WorkItem`: they take no key number, and no work-item read, list, board, search, transition, notification, automation or agent read has to exclude them. Accepting a request creates the work item through the ordinary create path, in the same transaction, so every rule in this ADR applies to it from its first row. Principle 3 concerns tracked work; a request becomes tracked work only when a person accepts it.
- The inflect-compliance patterns named here were read, not copied. Code written fresh from them is recorded in `PROVENANCE.md` as pattern only; code copied under ADR 0001 D1 gets a row per copied file.

## What would change this decision

- Customers need a project under more than one initiative, or an item in more than one project. A secondary "contributes to" link, outside the ancestry, is the likely answer, not a many-to-many parent.
- Customers need workspace-wide custom fields for cross-project reporting.
- Customers need a different manual order per view. A `(viewId, workItemId, sortKey)` table would then replace the single key for those views.
- Field-level conflicts become common enough that the client retry is not enough. Per-field versions, or Yjs for descriptions under ADR 0005, would replace the single version for those fields.
- The search ADR chose S2 (ADR 0008, 2026-11-20), which adds a plaintext search store beside the encrypted fields; a later move to keyed tokens (S3), S4, or a retention window other than 30 days would change this ADR again.
- Per-team transition rules or review gates become a requirement.
- Measurement at H2 shows a listed index unused, or a query without one.

## References

- Roadmap (`docs/ROADMAP.md`):
  - 2.2, ideas 2 (goal ancestry) and 3 (one table, many views);
  - 3, principles 3 and 5;
  - 4 (global preamble);
  - 2.1, 2.2, 2.4, 2.5, 2.7 and H2;
  - 3.1 (scheduler reads blocking relations), 3.2 (goals and initiatives);
  - 4.1 (comments on pages), 4.3 (live updates);
  - 5.3 (links by key), 5.5 (importers keep keys);
  - 6.5 (embeddings).
- Islestone ADRs: `docs/adr/0001-code-provenance-and-licences.md` (D1 and the copy rule), `docs/adr/0003-assignee-and-delegate.md`, `docs/adr/0006-vocabulary.md`.
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `prisma/schema/tasks.prisma` (lines 5–45, 64, 92–97, 100–114, 116–130);
  - `prisma/schema/enums.prisma` (lines 409–524);
  - `prisma/schema/processes.prisma` (lines 54–60);
  - `prisma/schema/agentic.prisma` (lines 231–236);
  - `src/app-layer/domain/task-status.ts` (lines 116–215);
  - `src/app-layer/repositories/TaskRepository.ts` (lines 597–605, 626–638, 693–699);
  - `src/app-layer/usecases/tenant-owner-lock.ts` (lines 1–30);
  - `src/lib/soft-delete.ts` (lines 12–33);
  - `src/lib/security/encrypted-fields.ts` (lines 292–296);
  - `CLAUDE.md` ("Data Retention"; the two-deploy enum rollout under "Agent recertification").
- npm registry, read 2026-11-18: `fractional-indexing` 4.0.0, licence `CC0-1.0`.
- Patterns reused from inflect-compliance, all pattern only, no code copied: the atomic per-scope key counter; the pure transition check with discriminated errors; composite parent keys with `tenantId`; the namespaced advisory transaction lock; the field-encryption manifest; `deletedAt`/`deletedByUserId` soft delete; the non-tenant-leading index for a cross-tenant sweep.
