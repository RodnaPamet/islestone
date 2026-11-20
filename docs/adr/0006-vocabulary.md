# 0006 — Vocabulary

Status: Proposed — awaiting owner sign-off (2026-11-18 drafted). The role names, their order, the fallback role and the public sign-up switch were decided by the owner on 2026-11-18, the sync and collaboration words ADR 0005 added on 2026-11-19, and the planning words of sub-phase 2.5 (Milestone, Cycle schedule, Burn-up, Repeat, Transition) on 2026-11-20, the intake words of sub-phase 2.6 on 2026-11-20, the work-item field words of sub-phase 2.4b (Waiting on, Field set, Answer) on 2026-11-20, and the review words of sub-phase 2.8 (Review step, Round, Reviewer, Signed off, Returned) on 2026-11-20; the other open questions await sign-off.

## Context

Islestone will hold dozens of domain concepts. Each one will reach a Prisma model, a Postgres table, row-level-security policies, route paths, permission keys, i18n keys, UI labels, API fields and audit rows. A word chosen in the first migration is expensive to change later. A concept with two names is worse: every reader has to learn that the names are the same thing, and every search has to try both.

This ADR fixes one name per concept before the first model is written (roadmap 1.3 creates the tenancy models, roadmap 2.1 the work-item models). ADRs 0002 and 0003 use these names.

How to read this ADR: a line marked **Verified** was read in the named file on 2026-11-18. A section marked **Decided** records an owner decision of 2026-11-18 or 2026-11-19, as it states. Everything else is a recommendation, and is not made until the owner signs.

### What happened in inflect-compliance

inflect-compliance is the parent product. Its task engine shows what a two-vocabulary state costs. Read at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`.

- **Verified.** The aggregate is the model `Task` (`prisma/schema/tasks.prisma` line 5). The file's own header calls it a "Generic work-item aggregate" (line 1).
- **Verified.** Its five enums were renamed from `WorkItem*` to `Task*` on 2026-08-12. Each still carries `@@map("WorkItem*")`, so the Postgres types keep the old names (`prisma/schema/enums.prisma` lines 409–503).
- **Verified.** The rename note gives the reasons (`docs/implementation-notes/2026-08-12-task-vocabulary-and-executing-tests.md` lines 13–42):
  - `Task` won on measured use: about 1,532 occurrences against about 155 for the enums.
  - Renaming the model would have changed every Prisma accessor and the physical table name that the RLS policies name.
  - The `@@map` pin is required because Prisma emits explicit enum casts. An `ALTER TYPE … RENAME` would make still-running old containers fail with SQLSTATE 42704 during a rolling deploy.
  - A test now guards the pin: `tests/integration/task-enum-db-mapping.test.ts`.
- **Verified.** A third name survives: `src/app-layer/repositories/IssueRepository.ts` lines 1–16 re-export `IssueRepository`, `IssueLinkRepository` and others as deprecated aliases of the `Task*` classes.
- **Verified.** The UI adds a fourth word and keeps the third. `messages/en.json` line 196 maps the entity key `ISSUE` to the label "tasks", the code's own word. Line 450 labels the tasks area "Plan" in the navigation, and line 449 labels a navigation entry "Issues".
- **Verified.** Prose kept the old words after the code moved. The `TaskKeySequence` comment still names `WorkItemRepository.create` (`prisma/schema/tasks.prisma` line 103). `src/app-layer/domain/task-status.ts` line 2 is headed "Work Item Status Constants" and line 91 names `setIssueStatus`.
- **Verified.** The same drift reached the agent queue. `AgentProposal.status` is typed `SuggestionItemStatus` (`prisma/schema/agentic.prisma` line 20), an enum shared with `RiskSuggestionItem` (`prisma/schema/enums.prisma` lines 868–885). A proposal's status is named for a suggestion.
- **Verified.** inflect-compliance calls an agent execution a `WorkflowRun` (`prisma/schema/agentic.prisma` line 396). In a project-management product, "workflow" means a team's set of states. Ported as is, that word would name two concepts.

The lesson Islestone takes: the cost was not any single name. It was letting a second name live beside the first, then paying for a rename under a rolling deploy.

## Decision

### Rules

1. **One word per concept.** The table below is the list. A new concept gets a row in this ADR, by amendment, before its first model or UI label exists.
2. **The model name is the code name.** Prisma models, enums, columns, TypeScript types, repository and usecase names, internal route segments and i18n keys use the table's model name. The customer-facing contract is the exception, listed in "Where code and UI differ": a route segment a customer can see (a page URL, a public API path), a permission key and an API key scope use the UI name, because they appear in the browser, in admin screens and in API documentation.
3. **Physical names equal Prisma names.** No `@@map` or `@map` renames a model, enum or column in Islestone's own schema. The table name in the RLS policies is the model name.
4. **Code and customer-facing text use the same word**, except for the closed list in "Where code and UI differ" below. Each exception is translated in one place only. Adding an exception is an amendment to this ADR.
5. **The "words not to use" are banned** for that concept: as model, enum, column, type or function names, as i18n keys, as UI labels, and in customer-facing documentation. In those places they may appear only:
   - as user data (a workspace may name a work item type "Story" or "Task");
   - inside an integration adapter, as the external system's own term, mapped to Islestone's term at that boundary (a Jira issue, a GitHub issue, a Linear issue, an Asana task, a Trello card, an MCP task, a SCIM group);
   - in prose that quotes another product.

   **Engineering prose** (ADRs, code comments, design notes) follows the table too, with two allowances. A word the table allows in prose stays allowed: "dependency" for a blocks relation. And a qualified term may be shortened once the document has defined it, where no other concept of that word is in play: ADR 0003 writes "session" for agent session and always says "sign-in session" for the other kind. A banned word is never used for the concept itself: an assignee is not the item's "owner", whatever the sentence.
6. **"Workflow" means a team's workflow states, and nothing else.** The agent engine never uses the word. inflect-compliance's `WorkflowRun` becomes `AgentRun` when its pattern is reused.
7. **Spelling is part of the vocabulary.** The spellings in the table are the spellings. In particular the state category is `CANCELLED`, with two Ls. inflect-compliance spells its status `CANCELED` (`prisma/schema/enums.prisma` line 458); a reused pattern takes Islestone's spelling.
8. **Ports translate on the way in.** Any pattern taken from inflect-compliance takes Islestone's names in the same change (`Task` → `WorkItem`, `RegisteredAgent` → `Agent`, `AgentProposal` → `Proposal`, `WorkflowRun` → `AgentRun`). `PROVENANCE.md` records each rename.

### The vocabulary

Rows for Phase 2 concepts are fixed by this ADR once signed. Rows for later phases reserve the word; the later phase designs the model's fields but does not choose a different word.

**Tenancy and people**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Organization | A customer's company account. It holds one or more workspaces and the org-level admins. | `Organization`; members `OrgMembership` | Organization | Company, Account, Enterprise |
| Workspace | The tenant: the unit of isolation, billing and membership. Every tenant table carries its id. | `Tenant`, column `tenantId` (see "Workspace naming" below) | Workspace | Tenant (in UI text), Account, Site, Space, Instance |
| User | A person's global sign-in identity, independent of any workspace. | `User` | Shown by the person's name | Account (NextAuth's `Account` is a sign-in provider link), Profile |
| Member | A user's membership in one workspace, with one role. Agents are never members. | `TenantMembership` | Member | Seat (billing only), Employee, Collaborator, Teammate |
| Role | The permission set a membership carries (roadmap 1.4). One of Owner, Admin, Member, Viewer, Guest (see "Roles" below). | enum `Role`: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, `GUEST` | Role; Owner, Admin, Member, Viewer, Guest | Access level, Permission level |
| Team | A group of members in a workspace. A team owns a workflow, cycles and estimates. | `Team` | Team | Squad, Department, Group (SCIM's word; stays in the SCIM adapter) |
| Sign-in session | A person's authenticated browser session. | `UserSession` | Session | Login. Never "session" alone in code, because of agent sessions |

**Work**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Project | A body of work owned by one team, with its own key prefix and custom fields. | `Project` | Project | Space, Board, Repository, Folder |
| Work item | The single unit of tracked work. One table holds every kind (roadmap principle 3). | `WorkItem` | Work item ("item" where the screen already names work items) | Task, Issue, Ticket, Card, Story, Epic |
| Sub-item | A work item whose parent is another work item in the same project. | `WorkItem.parentId` | Sub-item | Subtask, Child issue, Checklist item |
| Work item type | A workspace-configured kind of work item, such as Bug or Feature. | `WorkItemType` | Type | Issue type, Kind, Tracker, Category |
| Key | The readable identifier, such as `ISL-123`: the project's prefix and the item's number. | `Project.keyPrefix` + `WorkItem.number`; counter `ProjectKeySequence` | Key | Ticket number, Issue number, Ref |
| Priority | A fixed scale: none, urgent, high, medium, low. | enum `WorkItemPriority` | Priority | Severity (a workspace can add it as a custom field), P0–P3 |
| Workflow | A team's ordered set of workflow states. | No model: the team's `WorkflowState` rows | Workflow | Process, Pipeline, Lifecycle |
| Workflow state | One named step in a team's workflow, such as "In review". | `WorkflowState`; field `WorkItem.stateId` | Status (see below) | Status (in code), Stage, Column, Lane, Phase |
| State category | One of five fixed groups every state belongs to. | enum `WorkflowStateCategory`: `BACKLOG`, `UNSTARTED`, `STARTED`, `DONE`, `CANCELLED` | Backlog, Unstarted, Started, Done, Cancelled | Terminal, Resolved, Closed (as category names); the spelling CANCELED |
| Open, closed | Derived, not stored. Open means backlog, unstarted or started. Closed means done or cancelled. | No model | Open, Closed | Active (reserved for agent and agent-session states), Terminal |
| Relation | A typed link between two work items. | `WorkItemRelation`; enum `WorkItemRelationType`: `BLOCKS`, `RELATES`, `DUPLICATES` | Blocks, Blocked by, Related to, Duplicate of | Dependency (as a model or type name; in prose it means a blocks relation), Link |
| Link | A reference from a work item to something that is not a work item: a URL, pull request, commit, page or canvas. | `WorkItemLink` | Link | Relation, Reference, Attachment (an attachment is a file) |
| Label | A workspace-defined tag, optionally limited to one team. | `Label`; join `WorkItemLabel` | Label | Tag, Component, Category |
| Custom field | A typed field a project defines. Values are stored typed, not as JSON. | `CustomField`, `CustomFieldOption`, `CustomFieldValue` | Field | Property, Attribute, Column (a column displays a field in the list layout) |
| Comment | A person's message on a work item, and on a page from roadmap 4.1. | `Comment` | Comment | Note (a canvas shape), Message, Reply (as a model) |
| Watcher | A member who is notified about an item's changes. | `WorkItemWatcher` | Watching, Watchers | Subscriber, Follower |
| Activity | The timeline on an item: comments, changes read from the audit trail, and agent activity, merged for display. | No model: a read model | Activity | History, Feed, Log, Event |
| Audit entry | One row of the hash-chained audit log. | `AuditLog` | Audit log | Activity, Event, History |
| Template | A reusable starting point for a project or a work item (roadmap 2.5). | `ProjectTemplate`, `WorkItemTemplate` | Template | Blueprint, Preset |
| Repeat | The rule on a work item that makes a new copy of it on a schedule (decided 2026-11-20). | `WorkItemRecurrence`; enum `RecurrenceFrequency` | Repeat; "Repeats weekly" | Recurring task, Recurring issue, Routine |
| Transition | One recorded change to a work item's state, cycle, milestone, project or deletion, written by the database; read by the burn-up and by analytics (decided 2026-11-20). | `WorkItemTransition` | Not shown | History, Log, Event (each reserved: Activity, the audit log, automation), Snapshot |
| Waiting on | Who must act next on a work item, apart from its assignee: an active member, and from roadmap 6.3 possibly the delegate's agent session. It never makes anyone or anything accountable (ADR 0003 §1 is unchanged: the assignee stays the one accountable person). Cleared when the item closes (decided 2026-11-20). | `WorkItem.waitingOnUserId` (6.3 adds a session reference beside it; at most one of the two is set) | Waiting on; "Waiting on me" | Owner, Responsible, Assignee (for this field), Next owner, Blocked by (a relation's label), Awaiting (as this field's name: `AWAITING_INPUT` is an agent session state) |
| Field set | For one work item type, which fields are required, optional or hidden; enforced by the usecases and read by every form (decided 2026-11-20). | No model: the type's `WorkItemTypeField` rows; enum `FieldRequirement`: `REQUIRED`, `OPTIONAL`, `HIDDEN` | Fields; Required, Optional, Hidden | Field layout, Layout (a view's list, board, timeline or calendar), Form (an intake form), Property, Attribute |
| Answer | The one comment a person marks as a work item's answer; marking it moves an open item to a Done state (decided 2026-11-20). | `WorkItem.answerCommentId` | Answer; "Mark as answer" | Accepted answer (Accept is intake's verb), Solution, Resolution, Reply (as a model) |
| Review step | One ordered step of a work item's review: its reviewers (members, or recipient lists resolved when it opens), whether all or any one of them must sign off, and a due date in working days (ADR 0009; decided 2026-11-20). | `WorkItemReviewStep`; enums `ReviewStepMode` (`ALL`, `ANY`), `ReviewStepStatus`; the lists it names `WorkItemReviewStepList`; a type's defaults `WorkItemTypeReviewStep` (2.8c) | Review step; Review steps; "All must sign off", "Any one signs off" | Approval step, Approval workflow, Stage (for a review step), Gate (as this model), Review (alone: the proposal review page), Workflow (for a review step) |
| Round | One pass through an item's review steps. A Return ends it and a new round with the same steps follows; the ended round stays read-only, never rewritten (ADR 0009; decided 2026-11-20). | `WorkItemReviewRound`; enum `ReviewRoundStatus` | Round; "Round 2" | Revision (for a round), Iteration, Cycle (taken), Pass (for a round) |
| Reviewer | A person asked to respond to a review step: an active member who sees the project, never the item's assignee and never an agent (ADR 0009; decided 2026-11-20). | `WorkItemReviewer` (one row per person per step) | Reviewer; "To review" (My Work) | Approver, Signatory, Assignee (for this role) |
| Review outcome | A reviewer's response: Signed off or Returned, changeable until the step completes, then frozen (ADR 0009; decided 2026-11-20). | enum `ReviewOutcome`: `SIGNED_OFF`, `RETURNED`; the text `WorkItemReviewer.responseText` | Sign off, Return; Signed off, Returned | Approve (for a review outcome), Reject (for a review outcome), Accept (for a review outcome), Decline (for a review outcome), Pass (for a review outcome), Fail (for a review outcome) |

**Planning**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Cycle | A time-boxed period of one team that scopes work items. | `Cycle` | Cycle | Sprint, Iteration, Timebox |
| Cycle schedule | A team's rule for making cycles: their length, the first start date, how many upcoming cycles to keep and where unfinished items go when one ends (decided 2026-11-20). | `CycleSchedule` | Cycle schedule | Sprint plan, Sprint calendar |
| Burn-up | A cycle's chart of its scope and its completed items, day by day, read from transitions (decided 2026-11-20). | No model: a read model | Burn-up | Burndown, Velocity chart |
| Milestone | A named group of work items in one project with a due date (`Milestone.dueDate`, UI "Due date": "Target" is banned for goals; decided 2026-11-20). | `Milestone` | Milestone | Module, Release, Version, Phase, Epic |
| Goal | An outcome the workspace wants, with a target and a health status set by a person. | `Goal` | Goal | Objective, OKR, Key result, Target |
| Initiative | A set of projects that together serve a goal. | `Initiative` | Initiative | Program, Portfolio, Theme, Epic |
| Roadmap | The timeline layout over projects and initiatives. | No model: a view | Roadmap | Portfolio, Plan |

**Views, intake and inbox**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Layout | How rows render: list, board, timeline or calendar. | enum `ViewLayout` | List, Board, Timeline, Calendar | Kanban, Gantt (the timeline layout's chart), Mode |
| View | A saved scope, filters, grouping, sorting, layout and visible columns. Personal or shared. | `SavedView` | View | Filter (a filter is one part of a view), Perspective, Report |
| Intake | The stage before the backlog. Requests from forms, email and integrations wait there for triage. | No model: a stage | Intake | Inbox (reserved for notifications), Triage (as a noun for the stage; "triage" is the verb), Queue |
| Intake request | One entry in intake. A person accepts it (it becomes a work item), declines it, merges it into a duplicate or snoozes it. | `IntakeRequest` | Request | Ticket, Issue, Submission, Suggestion |
| Intake form | A form that creates intake requests in one project: for signed-in people, or, from roadmap 2.6b, anyone with its link (decided 2026-11-20). | `IntakeForm`; enum `IntakeFormAccess` | Form | Survey, Questionnaire, Submission form |
| Form field | One input of an intake form; it may fill one of the project's custom fields when the request is accepted (decided 2026-11-20). | No model: an entry in `IntakeForm.definitionJson` | Form field | Question (2.4b's work item type), Field (alone: a custom field's label), Property, Attribute |
| Requester | The person an intake request came from, a member or not (decided 2026-11-20). | `IntakeRequest.requesterUserId` (later `requesterName`, `requesterEmail`) | Requester; "From" | Reporter, Submitter, Customer |
| Intake channel | How a request arrived: an internal form, a public form or email (decided 2026-11-20). | enum `IntakeChannel`: `INTERNAL_FORM`, `PUBLIC_FORM`, `EMAIL` | Form, Public form, Email | Origin (as a model or enum) |
| Decline reason | Why a person declined a request: not planned, out of scope, spam or other (decided 2026-11-20). | enum `IntakeDeclineReason` | Reason | Rejection reason, Close reason |
| Notify list | The members a project's new intake requests notify (decided 2026-11-20). | `IntakeNotifyMember` | Notify list | Watchers (an item's watchers), Subscribers, Triagers |
| Intake email address | A project's address for requests by email, a random token at the intake domain (decided 2026-11-20; roadmap 2.6c). | `ProjectIntake.emailToken` | Intake email address | Inbox address |
| Follow-up | A later email from the requester on a pending request (decided 2026-11-20; roadmap 2.6c). | `IntakeFollowUp` | Follow-up | Reply (as a model), Message |
| Blocked sender | An email address, kept only as its lookup hash, whose requests a workspace or project drops (decided 2026-11-20; roadmap 2.6b and 2.6c). | `IntakeBlockedSender` | Blocked senders | Blacklist, Banned sender |
| Notification | A record that something needs a member's attention. | `Notification` | Shown in the Inbox | Alert, Message |
| Inbox | A member's list of notifications. A notification the member has finished with is marked **Done** (`Notification.archivedAt`), shown under the Inbox's Done tab (decided 2026-11-20; roadmap 2.7c). | No model: a view over `Notification`; `Notification.archivedAt` | Inbox; Done, "Mark as done" | Intake, Feed, Dismiss, Clear (as an Inbox action) |
| Notification preference | A member's choice, per notification type, of in-app on or off and email off, immediate or daily; the workspace's mute is the ceiling (decided 2026-11-20; roadmap 2.7c). | `NotificationPreference`; enum `EmailDelivery`: `OFF`, `IMMEDIATE`, `DAILY` | Notification preferences | Subscription (as a model), Setting (alone: `TenantNotificationSettings` is the workspace's), Alert rule |
| Digest | One email gathering a member's notifications and due items since the last one (decided 2026-11-20; roadmap 2.7c). | No model; `EmailNotificationType.NOTIFICATION_DIGEST` | Daily digest | Summary (as a model), Report (a view word), Newsletter |
| Mention | A person named in a comment or description with `@`; recorded per source and person, and the only thing that renders as a chip or notifies (decided 2026-11-20; roadmap 2.7d). | `Mention` | Mention; "Mentioned you" | Tag (a label's word), Ping, Callout |
| Recipient list | A named set of members, in a workspace or one project, that a person adds to an item's watchers in one step and that later features name as recipients; each member's preferences and project visibility are re-checked at send time (decided 2026-11-20; roadmap 2.7e, the roadmap's "distribution group"). | `RecipientList`; members `RecipientListMember` | Recipient list | Group (SCIM's word), Team (taken), List (alone: a layout), Notify list (intake's), Distribution group, Audience (as a model), Mailing list |
| Search vector | The stored full-text search vector of one work item's description or one comment: its stemmed words in plain text, by ADR 0008 (decided 2026-11-20; roadmap 2.7f). | `SearchVector` (`lexemes`) | Not shown | Search document (Document is a page's word), Search token (no tokens are stored: ADR 0008 D1), Index (alone, as a model) |
| My Work | A member's page of items assigned, created, watched and due soon. | No model | My Work | Home, Dashboard |

**Documents and canvas**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Page | A rich-text document in a project or workspace tree. | `Page` | Page | Doc, Document, Wiki, Note, Article |
| Canvas | A freeform drawing surface whose shapes can link to work items. | `Canvas`; children `CanvasNode`, `CanvasEdge`, `CanvasSnapshot` | Canvas | Whiteboard, Board, Process map, Diagram |
| Page content | A page's stored collaborative state (ADR 0005, section 6.4). The source of truth for the page body. | `PageContent` (working name) | Not shown as a noun | Document state, Body (as a model), Blob |
| Projection | Data derived from collaborative content on store: plain text, sanitised HTML, mentioned items (ADR 0005, sections 6.4 and 6.5). Read-only to everything but the collaboration server. | Columns or tables named for what they hold, such as `PageContent.plainText` | Not shown | Cache, Copy, Snapshot (a snapshot is a canvas version), Index (except a search index) |

**Sync and collaboration** (ADR 0005). **Decided. Owner decision, 2026-11-19** (ADR 0005, open question 11); the owner chose "Accept all". It confirms these three rows and the "Page content" and "Projection" rows above. `PageContent` stays a working model name.

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Change notice | A content-free message that a record changed: kind, id and version, never field values (ADR 0005, section 4). | TypeScript type `ChangeNotice`; no table | Not shown | Event (reserved for automation), Notification (reserved for the Inbox), Message |
| Collaboration server | The separate Node process that holds live pages and canvases (ADR 0005, section 6.1). | No model | Not shown | Realtime server, Socket server, Sync engine (a sync engine is ADR 0005's deferred option) |
| Collaboration token | The signed, short-lived credential the app mints for one connection to one document (ADR 0005, section 6.2). | No table; a signed value | Not shown | Ticket (banned for work items and intake requests, and refused as an identifier by the recommended ESLint rule), Session, Pass |

**Agents and automation**

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Agent | A non-human actor that can be delegated work. It has one accountable human owner. It is not a user and not a member. | `Agent` | Agent | Bot, AI, Assistant, Copilot, App user |
| Agent owner | The one member accountable for an agent. | `Agent.ownerUserId` | Agent owner | Owner (unqualified: OWNER is a role), Creator, Maintainer |
| Assignee | The one person accountable for a work item. | `WorkItem.assigneeId` | Assignee | Owner, Responsible, Assigned agent |
| Delegate | The at most one agent doing the work on an item for its assignee. | `WorkItem.delegateAgentId` | Delegate | Assignee (for an agent), Co-assignee, Helper, Worker |
| Agent session | One engagement of one agent, usually on one work item, from invocation to an end state. | `AgentSession` | Agent session | Session (unqualified), Conversation, Thread, Job, Run |
| Agent activity | One append-only entry in an agent session: prompt, thought, action, elicitation, response or error. | `AgentActivity` | Shown in the item's Activity, marked as the agent's | Comment, Event, Message, Log line |
| Checkout | An agent's exclusive hold on a work item while its session is live. | No model: the live `AgentSession` row | "Checked out by" the agent | Lock, Claim, Reservation |
| Agent run | One bounded execution of Islestone's agent engine: its model calls and tool calls. External agents have sessions but no runs. | `AgentRun`; steps `AgentRunStep` | Run | Workflow run, Job, Task, Execution (reserved for automation) |
| Proposal | A change an agent or the assistant asks a person to approve. Approval runs the real usecase as that person. | `Proposal` | Proposal | Suggestion, Draft, Change request, Pending change |
| Approve, edit, reject | The decisions a person makes on a proposal. | enum `ProposalStatus` (designed in ADR 0003) | Approve, Edit and approve, Reject | Accept, Commit, Apply, Decline |
| Assistant | The in-product chat surface. It answers as the signed-in person and turns suggestions into proposals. It is not an agent. | No model of its own | Assistant | Agent, Copilot, Chatbot, AI |
| Skill | A versioned package of instructions an agent mounts, gated by an evaluation record. | `Skill`, `SkillVersion` | Skill | Prompt, Playbook, Recipe, Plugin, Template |
| Policy card | The versioned limits an agent runs under: tools, data scope, autonomy, action counts, approval rung. | `AgentPolicyCard`, `AgentPolicyCardVersion` | Policy card | Guardrails, Rules, Permissions |
| Budget | A spending limit with a hard stop, per agent or per project, per month. | `AgentBudget` | Budget | Quota, Credit, Allowance |
| Cap | A limit inside one run: steps, tool calls, proposals, tokens, wall clock. | Engine constants, narrowed by the policy card | Limit | Budget (a budget spans runs) |
| Kill switch | A stop that refuses every further model and tool call, for one agent, one workspace or the platform. | `AgentKillSwitch`, `PlatformAgentKillSwitch` | Kill switch | Pause, Disable, Suspend (SUSPENDED is an agent status) |
| Automation rule | A trigger, conditions and actions that run when an automation event occurs. | `AutomationRule`; runs `AutomationExecution` | Automation rule; the area is "Automations" | Workflow, Recipe, Zap, Bot, Trigger (one part of a rule) |
| Automation event | A typed event the automation bus delivers to rules. | Event contract types, no table | Not shown as a noun | Activity, Audit entry |
| Job | One unit of background work on the queue. | BullMQ job; no Islestone model | Not shown | Task, Worker (the worker is the process) |

### Where code and UI differ

This list is closed. Each translation has one named home:

- labels: the UI catalogue;
- API field names, webhook payloads and audit exports: the public API serializer, which those two outputs share;
- public route segments, permission keys and API key scopes: there is nothing to translate, because they are written in the UI word where they are declared (the route directories under `src/app/`, the permission set of roadmap 1.4, the scope list of roadmap 5.2). Internal code that names the same concept still uses the model name.

| Code name | UI and public-contract name | Why they differ |
|---|---|---|
| `Tenant`, `tenantId` | Workspace | See "Workspace naming". Recommended option W1. |
| `TenantMembership` | Member | Follows from W1. |
| `WorkflowState`, `stateId` | Status | Users of comparable tools know the field as "Status". In code, `status` stays reserved for fixed enums (agent, agent session, proposal), so a configurable state never collides with them. Alternative: label it "State" and drop this exception. |
| `SavedView` | View | `View` alone is too generic for a model name in a codebase that also has React views. |

### Workspace naming — needs an owner decision

The roadmap already writes `tenantId` and "`Tenant` (a workspace)" (section 4 preamble; roadmap 1.3). Three options:

- **W1. `Tenant` in code and the database; "Workspace" in everything a customer reads.** Recommended.
  - Matches the roadmap's preamble and 1.3 as written.
  - "Tenant" is the precise word for the security boundary. RLS policies, `runInTenantContext`, `getTenantCtx` and the two-tenant tests in H1 are all about isolation.
  - ADR 0001 D1 allows copying inflect-compliance code, so ported code keeps its identifiers in the most security-sensitive layer. A missed rename inside RLS code is the worst place for a mistake.
  - Cost: two words for one concept. This ADR contains it by listing the exception and translating it in one place. The customer-facing contract (UI text, help docs, public API paths and fields, permission keys, API key scopes, webhook payloads, audit exports) says `workspace`; "Where code and UI differ" names where each part is written. A guard refuses `workspaceId` as an identifier outside the public API serializer and the public route segments, and refuses "tenant" in UI catalogue values, permission keys and scopes.
- **W2. `Workspace` everywhere**, column `workspaceId`, RLS setting named for the workspace.
  - One word, no exception.
  - Nothing is ported yet, so the rename costs little today.
  - Cost: the roadmap's preamble and 1.3 must be amended. Every pattern read from inflect-compliance is renamed on the way in, including RLS code.
- **W3. `Tenant` everywhere, including the UI.** Not recommended. "Tenant" is infrastructure jargon to the people using the product.

Decide before roadmap 1.3 writes the first migration. The column name is the expensive thing to change later, as the inflect-compliance history shows.

Owner sign-off: ____  Date: ____

### Roles — decided

**Decided. Owner decisions, 2026-11-18.**

- **The standard everyday role is called Member** (enum value `MEMBER`, UI label "Member"). The owner chose "Member". This is drafted option M2 (keep `MEMBER`); the draft had recommended M1 (rename it `EDITOR`). Options M1 and M3 were not chosen.
- **The roles are Owner, Admin, Member, Viewer and Guest** (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, `GUEST`).
- **They rank Owner > Admin > Member > Viewer > Guest, by breadth of access.** The owner chose "Owner>Admin>Member>Viewer>Guest". This is the order the 1.4 porting map recommends for declaring the `Role` enum (`docs/porting/maps/1.4.md`, "Enums"), so code that looks for the most senior member never lands on a guest.
- **A user whose role cannot be resolved falls back to Viewer, never Guest.**

Because "member" is also the concept "anyone with a membership", text about permissions says either "the Member role" or "any member", never "members" alone where the two readings differ.

### Public sign-up behind a switch — decided

**Decided. Owner decision, 2026-11-18; the owner chose "Behind a switch".** Public self-sign-up at `/api/auth/register` sits behind a switch. It is off by default in production and on in development, and an operator opens it without a code change. This is not a vocabulary rule. It is recorded here because the owner decided it together with the role questions, before ADR 0004 (authentication path) was decided. Roadmap 1.4 builds it when it ports the register route.

### Notification column names — decided

**Decided. Owner decision, 2026-11-19 (relayed to the porting session by its coordinator).** Two column names sub-phase 1.6 brought, where inflect-compliance's names break the rules above:

| Term | Meaning | Model name | UI label | Words NOT to use |
|---|---|---|---|---|
| Notification body | A notification's text, shown under its title in the Inbox. | `Notification.body`; the bus event's `body` | Not shown as a noun | Message (banned in identifiers; inflect-compliance's `message`) |
| BCC mailbox | A workspace's copy-to address: every email the workspace sends is also sent, blind, to it. | `TenantNotificationSettings.bccMailbox` | BCC mailbox | Compliance mailbox (inflect-compliance's `complianceMailbox`), Archive address |

### Planning words of sub-phase 2.5 — decided

**Decided. Owner decision, 2026-11-20 (relayed to the porting session by its coordinator; `docs/porting/maps/2.5.md`, open questions 1 and 13).** The roadmap's "`Module` or milestone" is a **Milestone**, one model per project, as the table already said. The table gains four rows: Cycle schedule, Burn-up, Repeat and Transition. A milestone's date is `dueDate`, shown as "Due date", because "Target" is banned for goals and the schema guard refuses it everywhere.

### Intake words of sub-phase 2.6 — decided

**Decided. Owner decision, 2026-11-20 (relayed to the porting session by its coordinator; `docs/porting/maps/2.6.md`, open questions 7 and 10; `docs/HANDOFF.md` decisions 91 and 94).** The triage page and its sidebar entry are called **Intake**, one entry is a **Request**, and "triage" stays a verb; the notification list of roadmap 2.7 stays **Inbox**. The "Views, intake and inbox" table gains the rows Intake form, Form field, Requester, Intake channel, Decline reason, Notify list, Intake email address, Follow-up and Blocked sender. "Accept" and "Decline" are intake's verbs: the Proposal row bans them as synonyms of Approve and Reject for proposals only. A request's states are the enum `IntakeRequestStatus` (`PENDING`, `SNOOZED`, `ACCEPTED`, `DECLINED`, `MERGED`), shown as New, Snoozed, Accepted, Declined and Merged. A form field is not called "Question", because roadmap 2.4b plans a Question work item type.

### Work-item field words of sub-phase 2.4b — decided

**Decided. Owner decisions 100 to 102, 2026-11-20 (relayed to the porting session by its coordinator; `docs/porting/maps/2.4b.md`, open questions 1 to 3; `docs/HANDOFF.md`).** The Work table gains the rows Waiting on, Field set and Answer. "Awaiting" stays the agent session's word (`AWAITING_INPUT`), and "Accept" stays intake's. By decision 106, waiting on may name the delegate's agent session from roadmap 6.3, through a second column beside `waitingOnUserId`; that never makes the session, or its agent, accountable. "Question" is a work item type a workspace makes (user data, like Feature), offered as a Settings preset and not seeded (decision 116).

### Search, inbox and mention words of sub-phase 2.7 — decided

**Decided. Owner decision 143, 2026-11-20 (relayed to the porting session by its coordinator; `docs/porting/maps/2.7.md`, open questions 11, 15 and 20; `docs/HANDOFF.md` decisions 134, 138 and 143).** The "Views, intake and inbox" table gains the rows Notification preference, Digest, Mention, Recipient list and Search vector, and the Inbox row gains **Done** as its archive verb (`Notification.archivedAt`), not Dismiss or Clear. The roadmap's "distribution group" is a **Recipient list** (decision 138). The map's drafted "Search token" row was written for keyed word tokens; ADR 0008 chose a plaintext full-text index instead (decision 124), so the row is **Search vector** (`SearchVector`), and "search token" names nothing. "Document" stays a page's banned word, which is why the table is not `SearchDocument`. ADR 0003 is not amended: a recipient list only notifies and never assigns, and a mention never delegates (6.3's agent mention is its own amendment).

### Review words of sub-phase 2.8 — decided

**Decided. Owner decisions 148 and 164, 2026-11-20 (relayed to the porting session by its coordinator; `docs/porting/maps/2.8.md`, open questions 1 and 17; `docs/HANDOFF.md`; ADR 0009).** The Work table gains the rows Review step, Round, Reviewer and Review outcome; the outcomes are **Signed off** and **Returned** (verbs Sign off, Return), and My Work's section is **To review**. "Review" alone stays the proposal review page's word (roadmap 6.2): the item's area is "Review steps" and a reviewer's list is "To review", never "Reviews". Approve, Edit and approve and Reject stay the proposal's verbs, Accept and Decline intake's; Pass and Fail are left to 4.5's checks. "Round" is not "Revision" (an item's content will have versions in 4.1), "Iteration" or "Cycle" (taken). The response text is never `note` or `message`.

### How Islestone avoids inflect-compliance's two-vocabulary state

1. **Names are fixed before the first migration.** This ADR is signed before roadmap 1.3 and 2.1 write models.
2. **No aliases.** No `@@map` renames, no re-exported second names (the `IssueRepository = TaskRepository` shape), no second enum family for the same values.
3. **Ports translate in the same change** (rule 8).
4. **Prose follows code.** A rename changes comments, docs and the i18n catalogue in the same change. The `WorkItemRepository` comment that outlived its file is the example to avoid.
5. **If a rename is ever needed after data exists,** it is a planned two-deploy change. A temporary physical pin such as inflect-compliance's `@@map` is allowed only with an end date recorded in this ADR. Removing the pin is part of the same plan. The inflect-compliance lesson is real: under a rolling deploy, the pin is what keeps old containers working. What Islestone avoids is a pin, and the second name it keeps alive, with no end.

### Recommended enforcement

These checks are recommendations. Roadmap 1.1 or 2.1 adds them with the first model.

- A schema test over `prisma/schema/`: no model, enum, field or enum value uses a banned word for its concept, and no `@@map` or `@map` exists without an entry in this ADR.
- An ESLint rule over exported identifiers in `src/`: it refuses `Task`, `Issue`, `Ticket`, `Sprint`, `Module`, `Whiteboard` and the other banned names as type, class or function names. Integration adapters (`src/lib/integrations/<provider>/`), the MCP protocol layer and the SCIM layer are outside its scope, because there the external term is the correct one.
- A catalogue test over `messages/en.json`: no value uses a banned UI word, with the same adapter carve-out for `integrations.<provider>.*` keys.
- Each check is proved by a planted violation in its own test.

### Open questions for the owner

1. Workspace naming: W1, W2 or W3.
2. **Decided, 2026-11-18:** the `MEMBER` role keeps its name (M2). See "Roles".
3. "Status" or "State" as the UI label for a workflow state.
4. UI copy spelling: British or American English? The roadmap mixes both ("authorise", "Organization"). Identifiers follow this table either way.
5. The roadmap uses "workflows" for agent engine definitions (roadmap 2.1, 6.1). This ADR reserves "workflow" for team states. Recommendation: roadmap 6.1 names the engine's definitions when it starts; "Agent profile" is the candidate, after inflect-compliance's `AgentProfile` model (`prisma/schema/agentic.prisma` line 3469). It must not be "workflow" or "task".
6. Seeded default work item types for a new workspace. Recommendation: Feature, Bug, Chore. Avoid seeding types named Task, Issue or Ticket, so new users do not meet a banned word on day one. Question is not seeded; Settings offers it as a preset (roadmap 2.4b, owner decision 116, 2026-11-20).

## Consequences

- Every later ADR, prompt and pull request uses these words. ADR 0002 (work-item model) and ADR 0003 (assignee and delegate) are written in them.
- Roadmap prompts that use other words are read through this table. Examples: 2.5 "`Module` or milestone" is a Milestone; 2.6 "triage inbox" is Intake; 4.2 "whiteboards" are Canvases; 6.1 "workflows" are not workflows in this vocabulary (see the open questions).
- Under W1, the codebase holds two words for the workspace, at a declared boundary, with a guard. Under W2, the roadmap's preamble needs an amendment.
- The Member role shares its word with the concept of a member. Permission text and help text must always say "the Member role" or "any member".
- Roadmap 1.3 declares `Role` in the decided order, and 1.4 writes the permission set for the five roles. The 1.4 porting map's "MEMBER (or EDITOR)" alternatives resolve to `MEMBER`.
- Integration adapters must map external terms at their boundary. An importer from Jira (roadmap 5.5) reads "issues" and writes work items; nothing past the adapter says "issue".
- Users of other tools will meet different words: Linear's "issue", Jira's "sprint", Plane's "module". Onboarding and import screens (roadmap 5.5, 8.2) should show the mapping once.
- The words reserved for later phases constrain those phases' prompts. A later phase that needs a different word amends this ADR first.

## What would change this decision

- The owner chooses W2, or another option above that is still open. The table changes in the same amendment.
- User research shows that customers do not understand a chosen word. Before launch, a word can change at the cost of one migration. After launch it costs a planned two-deploy change.
- An external standard Islestone must follow (an MCP extension, an import format) fixes a different word for a concept. The adapter rule (rule 5) is the default answer; a change to the core word would be a deliberate choice.
- A concept splits in two. For example, if customers need different manual orders per view, "order" may need its own term.

## References

- Roadmap (`docs/ROADMAP.md`):
  - 2.2, idea 1 (agents are delegates, not assignees) and idea 4 (intake);
  - 3, principles 1 to 3;
  - 4 (global preamble: `tenantId`, `RequestContext`);
  - 1.3 (`Organization`, `Tenant`, `TenantMembership`, `OrgMembership`);
  - 1.4 (roles OWNER, ADMIN, MEMBER, GUEST, VIEWER);
  - 1.7 (sidebar: My Work, Inbox, Views);
  - 2.1, 2.4, 2.5, 2.6, 2.7;
  - 4.1, 4.2;
  - 6.1, 6.2, 6.3, 6.4.
- Islestone ADRs: `docs/adr/0001-code-provenance-and-licences.md` (D1 and the copy rule), `docs/adr/0002-work-item-model.md`, `docs/adr/0003-assignee-and-delegate.md`, `docs/adr/0004-authentication-path.md`.
- Islestone porting map: `docs/porting/maps/1.4.md` (role values, "Enums", and the owner decisions it asked for).
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `prisma/schema/tasks.prisma` (lines 1, 5, 100–114);
  - `prisma/schema/enums.prisma` (lines 409–503, 458, 868–885);
  - `prisma/schema/agentic.prisma` (lines 20, 396, 3469);
  - `src/app-layer/domain/task-status.ts` (lines 2, 91);
  - `src/app-layer/repositories/IssueRepository.ts` (lines 1–16);
  - `messages/en.json` (lines 196, 449, 450);
  - `docs/implementation-notes/2026-08-12-task-vocabulary-and-executing-tests.md`;
  - `tests/integration/task-enum-db-mapping.test.ts`, `tests/unit/task-repository-seam.test.ts` (existence checked).
- Pattern reuse from inflect-compliance in this ADR: the lesson of the `@@map` pin and its rename note. Pattern only, no code copied.
