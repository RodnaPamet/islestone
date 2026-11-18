# Islestone roadmap

Drafted 2026-11-18. Islestone is an AI-enabled project-management SaaS spun off from inflect-compliance. This document holds the open-source research, the build phases with a prompt for each sub-phase, and the hardening gate that closes each phase.

## 1. How to use this document

- Each sub-phase is one pull request, or a short series. Paste its prompt into a coding session together with the **global preamble** in section 4.
- A phase is not finished until its hardening gate passes. Hardening is its own pull request series, not a footnote to the feature work.
- Sizes are relative: S (days), M (one to two weeks), L (several weeks) for one engineer with an assistant.
- Research facts were checked on 2026-11-18 against LICENSE files and the npm registry. Items marked *unverified* came from secondary sources; re-check them before relying on them.

## 2. Research findings

### 2.1 What ports from inflect-compliance

| Area | Location in inflect-compliance | Verdict | Main cut |
|---|---|---|---|
| Shared UI package | `packages/ui` (`@inflect/ui`, about 400 files) | Port as is | None; already consumed by a second product through hash-synced copies (`docs/shared-ui-policy.md`) |
| Remaining UI primitives | `src/components/ui`, `components/layout`, command palette (494 files classified GENERIC in `docs/_status/ui-core-classification.json`) | Port as is | Navigation lists, tenant/org context providers, brand tokens |
| Task engine | `prisma/schema/tasks.prisma`, `usecases/task.ts`, `TaskRepository.ts`, `domain/task-status.ts`, tasks pages | Port with renames | Links to Control, Finding and Evidence; compliance enums. There is no board, sprint, project or epic today |
| Process canvas | `src/components/processes`, `src/lib/processes`, `processes.prisma` | Port with renames | Compliance node taxonomy and control overlays. Collaboration is not built |
| Agent engine | `src/lib/agentic` (drivers, engine-tools, run store, proposals, kill switch, caps), `app-layer/ai/guard`, `src/lib/mcp` transport and auth | Port with renames | All ten workflows, all skills and most MCP tools are compliance-specific: rewrite. Leave the harness scanner, recertification and audit modules behind |
| Automation and jobs | `app-layer/automation`, `app-layer/jobs`, `scripts/worker.ts`, `app-layer/notifications` | Port with renames | Trim the event contracts and the executor registry |
| Platform | RLS (`lib/db-context.ts`, `lib/db/rls-middleware.ts`), auth (`src/auth.ts`, `lib/auth`), SCIM, encryption, audit hash chain, rate limiting, observability, storage, Stripe | Port as is or with renames | Regenerate the tenant-scoped model list; rewrite permission keys; prune `Tenant` and `User` relations |
| Tooling | CI workflows, Jest projects, guardrails, ESLint local rules, docs site, semantic-release | Port with renames | Many guards test compliance content |

Two blockers come out of this inventory:

1. **inflect-compliance is BUSL-1.1**, licensor Inflect Ltd. Islestone may use the code only if Inflect Ltd. grants it or owns Islestone. Get that in writing first (sub-phase 0.1). **Decided 2026-11-18 ([ADR 0001](adr/0001-code-provenance-and-licences.md) D1, with D2):** copying is allowed, every copied file gets a `PROVENANCE.md` row, and Islestone is BUSL-1.1 from the same licensor.
2. **tldraw is proprietary.** inflect-compliance pins `tldraw ^3.15.6`, where production use is allowed with the watermark. Version 4 and later refuse to run in production without a paid key, and the current release is 5.x, so staying on 3.x means no upgrades. Islestone must choose: stay on 3.x, buy a key (price by quote), or move the canvas to Excalidraw (MIT). **Decided 2026-11-18 ([ADR 0001](adr/0001-code-provenance-and-licences.md) D3):** stay on tldraw 3.x (3.15.6) with the watermark visible.

### 2.2 Open-source project-management suites

Almost every mature suite is copyleft or source-available, so few are safe to copy code from.

| Verdict | Projects | Use |
|---|---|---|
| **Port candidates** (permissive, TypeScript) | **Kaneo** (MIT; React 19, Hono, Drizzle, Postgres): projects, tasks, subtasks, dependencies, custom fields, time entries, workflow rules, GitHub integration. **Paperclip** (MIT; Drizzle, Postgres): agent, goal, budget, heartbeat and run schema with atomic checkout locks. **Teable `packages/*`** (MIT; the apps are AGPL): field types and formulas. **Cal.diy** (MIT): availability and booking. **Paca web** (Apache-2.0): automation graph builder. **ln-dev7/circle** (MIT): Linear-style UI shell | Translate schema and logic into Prisma and the usecase layer; record provenance |
| **Inspiration only** (AGPL or GPL) | Plane, OpenProject, Twenty, Leantime, Worklenz, Vikunja, Docmost, AppFlowy, solidtime, Kimai, It's a Plan, Tegon (archived), Focalboard (unmaintained) | Read for product ideas. Do not copy code |
| **Inspiration only** (source-available) | Multica (Apache plus a no-hosting clause), NocoDB (Sustainable Use since January 2026), Planka (fair-use licence), Outline (BSL), Taskosaur (BSL), Huly (EPL-2.0, repository frozen) | Same |
| **Gone or going** | Vibe Kanban (sunsetting), Tegon, Roo Code, Cal.com (closed source since April 2026) | Patterns only |

Five ideas worth taking from the field:

1. **Agents are members, but delegates rather than assignees.** A person stays accountable; the agent gets a session, an activity stream, a budget with a hard stop and a review gate (Linear's agent guidelines, Jira agents, Plane Agents, Paperclip).
2. **Goal ancestry on every work item**, so a person or an agent can always answer "why" (Paperclip, Leantime).
3. **One work-item table, many saved views.** Cycles, modules and views are scopes and layouts over the same rows with typed custom fields (Plane, Kaneo, Teable).
4. **Intake as its own stage** before the backlog: accept, decline, merge duplicates, snooze (Plane, Tegon).
5. **Visual automation aware of repository activity and time** (Paca, Kaneo, It's a Plan's cycle rollover).

### 2.3 Libraries to embed

| Need | Pick | Notes |
|---|---|---|
| Gantt and timeline | SVAR React Gantt (MIT core) plus in-house critical path | Auto-scheduling and baselines are in the paid PRO tier. DHTMLX community is now MIT but imperative |
| Drag and drop | Atlassian pragmatic-drag-and-drop (Apache-2.0) | Works with virtualised lists. `@dnd-kit/react` is still pre-1.0 |
| Rich text | Tiptap MIT core (already in inflect-compliance) | Tiptap comments, AI toolkit and conversion are paid: build those. Plate is the MIT fallback with an AI plugin |
| Document collaboration | Yjs plus Hocuspocus (both MIT) | Self-hosted Node, Redis extension |
| Canvas | tldraw 3.x (3.15.6), watermark visible | Decided 2026-11-18 (ADR 0001 D3). The licensed tldraw and Excalidraw (MIT) were the options not chosen |
| Calendar | inflect-compliance calendar surface; FullCalendar MIT core if more is needed | Resource timelines are premium |
| Scheduling | In-house critical path and Monte Carlo; Timefold Community (Apache-2.0, JVM sidecar) later | No credible JavaScript critical-path library exists |
| Workflow | BullMQ flows (already used) plus React Flow (MIT) for a visual builder | |
| Search | Postgres full-text search plus pgvector | Row-level security applies for free. Encrypted fields (descriptions, comment bodies) need the search decision in ADR 0002 section 11 |
| Tables | TanStack Table (already used) | Univer (Apache-2.0) if formulas are needed |
| Charts | visx charts already in `@inflect/ui` | |
| Integrations | Vendor SDKs: `octokit`, `@gitbeaker/rest`, `jira.js`, `@linear/sdk`, `asana`, `trello.js` | No good open-source importer library exists; write mappers |
| Webhooks out | inflect-compliance `webhook-headers.ts` pattern, or Svix (MIT server) | |
| Email | react-email (MIT) on the existing outbox | |
| Files | Uppy plus tus (MIT) on the existing storage layer | |
| Flags and analytics | OpenFeature plus GrowthBook; PostHog | Never import from `ee/` folders |
| Auth | Port NextAuth v4 with SSO, MFA and SCIM now; plan a move to Better Auth (MIT) | Auth.js v5 never left beta and is reported to be in security-only maintenance (*unverified*) |

### 2.4 AI and agent building blocks

The inherited engine already does what agent frameworks sell. Adding Mastra, LangGraph or the OpenAI Agents SDK would create a second tool loop outside the approval funnel, so none is adopted.

| Adopt | Evaluate | Build in-house on the engine |
|---|---|---|
| MCP TypeScript SDK v2 and the 2026-07-28 spec (stateless transport, elicitation, tasks extension) | Vercel AI SDK 7 for UI streaming only | Delegate, session and activity data model |
| MCP Apps (`modelcontextprotocol/ext-apps`) for interactive UI inside customers' assistants | AG-UI as a wire format; Chat SDK for Slack and Teams | Work breakdown, triage, digest and text-to-filter skills with evaluation records |
| assistant-ui (MIT) or AI Elements (Apache-2.0) for chat UI | Timefold sidecar; Graphiti or mem0 for memory | Throughput Monte Carlo forecasting and risk signals |
| pgvector; an embeddings provider behind an interface (Voyage is the hosted candidate and a new sub-processor) | Claude Managed Agents (stores data at Anthropic) | Duplicate detection (embeddings plus rerank) |
| promptfoo (MIT) for evals and red-teaming; Langfuse MIT core with OpenTelemetry GenAI attribute names | Vexa or WhisperX for meeting capture | Meeting notes to action items |
| Vendor MCP servers (GitHub, Atlassian, Notion, Linear, Asana, Slack) as connectors | | |

### 2.5 Licence traps

- **AGPL servers or apps:** Plane, Twenty, Docmost, ParadeDB, Triplit, Lago, Formbricks, Unleash, `@liveblocks/server`, VectorChord.
- **Paid or copyleft add-ons to permissive cores:** BlockNote `xl-*` (GPL or paid), Tiptap comments and AI, FullCalendar premium, SurveyJS Creator, SVAR PRO.
- **Not embeddable in a SaaS:** n8n (Sustainable Use), Windmill (AGPL with a no-embed clause), HyperFormula (GPL), Handsontable (commercial), planby (all rights reserved), Nango and Airbyte (Elastic-2.0), Inngest server (SSPL), Arize Phoenix (Elastic-2.0).
- **Not what the name suggests:** Multica ("Apache" with a hosting ban), task-master (MIT plus Commons Clause), Sweep, Screenpipe.
- **Open-core `ee/` folders:** PostHog, GrowthBook, Novu, Activepieces, Mastra, Langfuse, CopilotKit.
- **Dead or stale:** gantt-task-react, Glide Data Grid, Novel, y-sweet, Oso, Replicache, LlamaIndex.TS, LLM Guard, MCP-UI.
- **Model weights** are licensed separately from model code.

## 3. Product principles

1. **People are accountable; agents are delegated.** A work item has one human assignee and, optionally, one agent delegate.
2. **Agents propose, people approve.** Every agent write goes through the proposal queue until a workspace owner raises a specific rung. A session someone other than the item's assignee started proposes at every rung (ADR 0003, decision 10).
3. **One work-item table.** Views, cycles, modules and roadmaps are scopes over it.
4. **Deterministic numbers, explained by a model.** Schedules and forecasts come from code. A model explains them and never invents them.
5. **Tenant isolation at the database.** Every tenant table has row-level security from its first migration.
6. **Every port is recorded.** Source repository, commit, licence and what changed.

## 4. Global preamble (prepend to every prompt)

> You are working in the `islestone` repository: Next.js 16 App Router, React 19, TypeScript, Prisma on PostgreSQL with row-level security, BullMQ, Tailwind 4. Layers: route handlers parse and respond; usecases hold logic and take a `RequestContext` first; policies authorise before any data access; repositories filter by `tenantId`. Read `docs/ROADMAP.md` and `docs/adr/` before you start. When the prompt says "port from inflect-compliance", read the named files in the sibling checkout, copy only what the prompt names, strip compliance-domain imports, and add an entry to `PROVENANCE.md` (source path, commit, licence, changes). Never copy code from a project marked "inspiration only" in the roadmap. Every new tenant table gets `tenantId`, a tenant-leading index, row-level-security policies in the same migration, and a two-tenant test. Every mutation is validated with Zod, authorised with `requirePermission`, sanitised where it takes free text, and audited with `logEvent`. Ship tests that fail when the behaviour regresses. If a step would contradict an ADR, stop and ask.

## 5. Phases

### Phase 0 — Clearance and decisions

#### 0.1 Licence and ownership clearance (S)
- **Build:** written grant from Inflect Ltd. for Islestone's use of the BUSL-1.1 code; Islestone's own licence choice; the tldraw decision.
- **Prompt:** "Write `docs/adr/0001-code-provenance-and-licences.md`. Record: the inflect-compliance licence (BUSL-1.1, Additional Use Grant) and the exact grant Islestone relies on, with a placeholder for the signed reference; Islestone's own licence; the canvas decision among tldraw 3.x with watermark, a paid tldraw key, or Excalidraw, with the cost and upgrade consequence of each. List what you could not confirm from the repositories as open questions for the owner."
- **Done when:** the owner has signed off each decision in the ADR.
- **Decided, 2026-11-18** ([ADR 0001](adr/0001-code-provenance-and-licences.md), Accepted): code may be copied from inflect-compliance, each copied file recorded in `PROVENANCE.md` (D1); Islestone is BUSL-1.1, licensor Inflect Ltd. (D2); the canvas stays on tldraw 3.x with the watermark (D3). A fourth decision came out of the work: inflect-compliance's UI layer is largely derived from Dub (AGPL-3.0) and carries Nucleo icons, and the owner chose to copy it as is and accept the licence risk (D4).

#### 0.2 Architecture decisions (S)
- **Build:** ADRs for the work-item model, the assignee/delegate rule, the auth path, the sync strategy and the naming of the task aggregate.
- **Prompt:** "Write ADRs 0002 to 0006: (2) one `WorkItem` table with configurable types and a parent chain of goal, initiative, project, item, sub-item; (3) human assignee plus optional agent delegate, agents write through proposals; (4) port NextAuth v4 with SSO, MFA and SCIM now, with criteria for a later move to Better Auth; (5) server-authoritative data with optimistic UI now, Yjs for documents and canvas, a sync engine such as Zero deferred with the conditions that would reopen it; (6) vocabulary: one name per concept, listed. Each ADR states context, decision, consequences and what would change the decision."
- **Done when:** five ADRs merged.

#### 0.3 Third-party intake policy (S)
- **Build:** `PROVENANCE.md`, `NOTICE`, a dependency licence allowlist enforced in CI.
- **Prompt:** "Add `PROVENANCE.md` with a table (component, source, commit, licence, changes). Add a CI step that fails on any production dependency whose licence is not on an allowlist of MIT, Apache-2.0, BSD, ISC, MPL-2.0 (unmodified use), PostgreSQL and the recorded tldraw exception, and on any import path containing `/ee/`. Add a test proving the step fails on a planted GPL dependency."

**Hardening H0.** Licence gate green on an empty repository; a planted violation fails it; every roadmap "port candidate" has its LICENSE file re-read and its commit pinned in `PROVENANCE.md` before first use.

### Phase 1 — Foundation port

#### 1.1 Repository skeleton (S)
- **Prompt:** "Bootstrap the repository: npm workspaces, Node 24, Next.js 16, React 19, strict TypeScript, flat ESLint config, Jest projects for node and jsdom, Playwright, docker-compose with Postgres, PgBouncer and Redis, and a CI workflow running lint, typecheck, tests and build. Port the env pattern from inflect-compliance (`src/env.ts` and `src/env-client.ts`, with the guard that client-reachable modules import only the client module). Write `CLAUDE.md` with the layer rules and commands."

#### 1.2 Shared UI (M)
- **Source:** `packages/ui`, the GENERIC files under `src/components/ui`, `docs/shared-ui-policy.md`.
- **Prompt:** "Bring the shared UI into `packages/ui` using the hash-synced copy model that inflect-compliance documents in `docs/shared-ui-policy.md`: copy `@inflect/ui` byte for byte with a manifest of file hashes and a script that reports drift from upstream. Then copy the files classified GENERIC in `docs/_status/ui-core-classification.json` (table, filter, combobox, date-picker, modal, sheet, form, charts, dashboard grid, hooks). Leave MIXED and COUPLED files out and list them. Add Islestone's own `tokens.css` satisfying `tokens.contract.css`, with light and dark themes."
- **Done when:** a storybook-style gallery page renders every primitive in both themes.

#### 1.3 Tenancy and data core (M)
- **Source:** `lib/db-context.ts`, `lib/db/rls-middleware.ts`, `app-layer/context.ts`, `prisma/schema/base.prisma`, `auth.prisma`, `docs/rls-tenant-isolation.md`.
- **Prompt:** "Create the multi-file Prisma schema with `Organization`, `Tenant` (a workspace), `User`, `TenantMembership`, `OrgMembership`, pruned of every compliance relation. Port the row-level-security middleware, `runInTenantContext`, `RequestContext` and `getTenantCtx`. Port the guardrail that fails CI when a tenant table lacks its policies, and the last-owner trigger with its advisory lock."

#### 1.4 Authentication and roles (L)
- **Source:** `src/auth.ts`, `src/middleware.ts`, `lib/auth/`, `lib/scim/`, `lib/permissions.ts`, `lib/security/permission-middleware.ts`.
- **Prompt:** "Port authentication: credentials, Google and Microsoft sign-in, session rows with revocation, MFA, password policy with the breach check, invites, and the tenant-access gate in middleware. Port SSO and SCIM behind a feature flag. Write a new `PermissionSet` for project management (workspace, projects, work items, views, cycles, docs, canvas, automations, integrations, agents, billing, admin) with roles OWNER, ADMIN, MEMBER, GUEST and VIEWER, and port `requirePermission` with its denial audit row. Port the guards for membership-creation paths and permission coverage."
- **Decided 2026-11-18 ([ADR 0006](adr/0006-vocabulary.md)):** the roles rank Owner > Admin > Member > Viewer > Guest by breadth of access, and `Role` is declared in that order; a user whose role cannot be resolved falls back to Viewer, never Guest; public self-sign-up at `/api/auth/register` sits behind a switch, off by default in production, on in development, opened by an operator without a code change.

#### 1.5 Security perimeter (M)
- **Source:** `lib/security/` (encryption, sanitize, rate-limit), `lib/audit/`, `scripts/detect-secrets.sh`.
- **Prompt:** "Port field encryption with per-tenant keys and an empty manifest, the hash-chained audit log with `logEvent`, the three rate-limit tiers, rich-text sanitisation, `safeFetch` for outbound requests, and secret detection in pre-commit and CI. Port the startup checks that refuse a production boot with a missing or default encryption key."

#### 1.6 Jobs, notifications and observability (M)
- **Source:** `app-layer/jobs` (queue, scheduler, executor registry shape, worker heartbeat), `scripts/worker.ts`, `app-layer/notifications`, `lib/observability/`.
- **Prompt:** "Port the BullMQ infrastructure with an empty executor registry, the worker and scheduler entry points, `runJob`, the notification outbox and digest, and the observability barrel (logger, tracing, metrics, graceful shutdown). Replace the mail templates with react-email. Add one sample job with a test."

#### 1.7 Application shell (M)
- **Source:** `components/layout`, `components/command-palette`, `messages/en.json`.
- **Prompt:** "Build the app shell from the ported layout primitives: sidebar with workspace switcher, projects, My Work, Inbox, Views and Settings; command palette with keyboard shortcuts registered through `useKeyboardShortcut`; `EntityListPage`, `EntityDetailLayout` and `DashboardLayout`; next-intl with an English catalogue. Write the navigation config fresh; do not port the compliance module lists."

#### 1.8 Environments and delivery (M)
- **Prompt:** "Add the container build, a staging environment, preview deployments per pull request, database migration on deploy with a forward-fix policy, semantic-release, image publishing, and a change-management document defining standard, significant and emergency changes. Add health, liveness and readiness endpoints."

**Hardening H1.**
- Two-tenant integration tests prove no read or write crosses tenants on every table, as the application database role.
- Auth abuse tests: lockout, session revocation that actually signs out, invite token burn on mismatch, cross-tenant slug access refused.
- Baseline DAST scan (OWASP ZAP) nightly and blocking; dependency audit and container scan blocking.
- Bundle-size budget per route; a guard that no server env schema reaches the client.
- Accessibility pass (axe) on the shell and every primitive in the gallery.
- A restore of a staging backup performed once and documented.

### Phase 2 — Work core

#### 2.1 Work-item model (L)
- **Source:** inflect-compliance `tasks.prisma`, `domain/task-status.ts`; Kaneo schema (MIT) for subtasks, dependencies and labels.
- **Prompt:** "Create `Team`, `Project`, `WorkItem`, `WorkItemType`, `WorkflowState` (per team, each in a category of backlog, unstarted, started, done, cancelled), `WorkItemRelation` (blocks, relates, duplicates), `Label`, and a per-project key sequence giving keys such as `ISL-123`. Port the key-sequence and status-transition logic from the inflect-compliance task engine, replacing the fixed status enum with states by category. Order items with fractional indexing. Refuse dependency cycles in the usecase and prove it with a property test."

#### 2.2 Usecases, API and activity (L)
- **Source:** `usecases/task.ts`, `TaskRepository.ts`, the 19 task routes, comments, watchers.
- **Prompt:** "Port the task usecases, repository and routes as work-item equivalents: list with cursor pagination, get, create, update, delete with restore, assign, bulk update, comments with sanitisation, watchers, and an activity feed built from the audit trail. Add optimistic concurrency with a version column and a 409 on conflict. Encrypt description and comment bodies through the manifest."
- **Owner decision, 2026-11-18** ("In 2.2"): due-date reminders (the shared in-app helper and the daily job) land here with the work-item engine, not in 2.7. The email due digest is part of 2.7's digests.

#### 2.3 List, board and detail views (L)
- **Source:** `TasksClient.tsx`, task detail page; pragmatic-drag-and-drop; circle (MIT) for layout ideas.
- **Prompt:** "Build the work-item list on `EntityListPage` with the filter system, the board with pragmatic-drag-and-drop (columns by state, swimlanes by any field, virtualised columns, keyboard reordering), and the detail view as both a sheet and a full page. All three read the same query. Destructive actions use the undo toast. Mutations are optimistic with rollback."

#### 2.4 Saved views and custom fields (L)
- **Source:** Teable `packages/core` (MIT) for field types; Kaneo for custom fields.
- **Prompt:** "Add `SavedView` (filters, grouping, sorting, layout, visible columns; personal or shared) and typed custom fields per project (text, number, select, multi-select, date, person, URL, checkbox) stored in a typed value table with indexes. Custom fields appear in filters, columns, board grouping and the API. Check Teable's per-package licence before translating any field logic and record it in `PROVENANCE.md`."

#### 2.5 Cycles, modules, templates and recurrence (M)
- **Prompt:** "Add `Cycle` (time-boxed, per team, automatic rollover of unfinished items by a scheduled job), `Module` or milestone (a scoped group with a target date), project and item templates, and recurring items generated by a job. Each cycle page shows scope, completed, and a burn-up chart."

#### 2.6 Intake and triage (M)
- **Prompt:** "Add an intake stage: public and internal forms built with react-hook-form, an inbound email address per project, and a triage inbox where an item is accepted, declined, merged into a duplicate or snoozed before it reaches the backlog. Rate-limit and sanitise every public entry point."

#### 2.7 Search, inbox and My Work (M)
- **Prompt:** "Add Postgres full-text search over items and comments with a tenant-leading index, searching encrypted description and comment bodies only as the search ADR called for by ADR 0002 section 11 decides, a notification inbox with per-event preferences and digests, mentions, and a My Work page (assigned, created, watching, due soon). Search lives inside the filter popover and the command palette."

**Hardening H2.**
- Performance: seeded tenants at 10,000 and 100,000 items; list, board and search stay under an agreed response budget; no query in a loop; every list query has a backing index (port the index and query-shape guardrails).
- Concurrency tests for reordering, key allocation and bulk updates under parallel writers.
- A permission matrix test: every role against every work-item route, including guests limited to their projects.
- Drag and drop passes keyboard and screen-reader checks.
- Public forms and email intake fuzzed for injection, oversized bodies and floods.
- End-to-end tests run in isolated tenants; no shared mutable state between tests.

### Phase 3 — Planning, time and forecasting

#### 3.1 Timeline and critical path (L)
- **Source:** SVAR React Gantt MIT core; the gantt chart primitive in inflect-compliance.
- **Prompt:** "Add a timeline view using SVAR React Gantt (MIT core only; import nothing from PRO). Write the scheduling engine in-house as a pure module: forward and backward pass over the dependency graph, float, critical path, working calendars and holidays. The engine takes plain data and returns plain data, with no database access. Dragging a bar creates a change the user confirms."

#### 3.2 Goals, initiatives and roadmaps (M)
- **Source:** Paperclip (MIT) goal schema for ancestry.
- **Prompt:** "Add `Goal` and `Initiative` above projects, with progress rolled up from child items and a health status set by a person. Every work item can answer its ancestry in one query. Add a roadmap view across projects and a portfolio page per initiative."

#### 3.3 Calendar (M)
- **Source:** inflect-compliance calendar usecases and user calendar connections.
- **Prompt:** "Port the calendar surface: a calendar view of items, cycles and milestones, and two-way sync of due dates to Google and Microsoft calendars through the ported connection model. Event titles pushed outside carry item titles only."

#### 3.4 Time tracking (M)
- **Prompt:** "Add time entries (timer and manual), estimates in points or hours per team, timesheets with weekly approval, and a billable-rate cascade of project, member, workspace. Write it fresh; the open-source time trackers are AGPL and are reference reading only."

#### 3.5 Workload and capacity (M)
- **Prompt:** "Add member capacity (hours per week, time off) and a workload view showing allocation against capacity per person per week, with over-allocation flagged. Read-only suggestions for now; no automatic levelling."

#### 3.6 Analytics and forecasting (L)
- **Source:** `bitovi/jira-auto-scheduler` (MIT) for the Monte Carlo approach.
- **Prompt:** "Add analytics: cycle time, lead time, throughput, cumulative flow, burn-up. Add a forecasting module, pure and seeded, that runs Monte Carlo simulation over historical throughput to give a completion-date distribution for any scope, shown as dates at 50, 85 and 95 percent. Refuse to forecast with fewer than a stated minimum of completed items and say so. Add a configurable dashboard on the ported dashboard grid."

**Hardening H3.**
- Property tests on the scheduler: cycles refused, results stable under input reordering, calendars correct across time zones and daylight-saving changes.
- Forecast backtest: replay historical data and check that 85 percent forecasts hold roughly 85 percent of the time; publish the calibration.
- Same seed gives the same forecast; an empty or tiny history is never reported as a confident date.
- A 5,000-item project renders the timeline within budget.
- Calendar sync tested for revoked tokens, duplicates and deleted events.

### Phase 4 — Documents, canvas and realtime

#### 4.1 Documents (L)
- **Source:** Tiptap editor in inflect-compliance; Yjs; Hocuspocus.
- **Prompt:** "Add pages: a tree per project and workspace, the Tiptap editor with slash commands, work-item mentions and embeds, version history, and comments written in-house on the existing comment model. Add collaboration with Yjs and a Hocuspocus server that authenticates the session and checks tenant and page permission on every connection."

#### 4.2 Canvas (L)
- **Source:** `src/components/processes`, `src/lib/processes`, `processes.prisma`; subject to ADR 0001.
- **Prompt:** "Port the process canvas as Islestone whiteboards per ADR 0001: the map, node, edge and snapshot models, the serializer, auto-layout with dagre and elk, history and diff. Replace the compliance node taxonomy with shapes for work items, notes, groups and flows. Selecting shapes can create work items, and items dropped on the canvas stay linked. Load the canvas with a dynamic import and an error boundary."

#### 4.3 Live updates and presence (M)
- **Prompt:** "Add live updates for lists, boards and detail views over a tenant-scoped channel backed by Redis pub/sub, with presence on items, pages and canvases. Messages carry ids and versions only; clients refetch through the normal authorised API."

#### 4.4 Files (M)
- **Source:** `lib/storage/`; Uppy and tus.
- **Prompt:** "Port the storage layer (S3 and local providers, signed URLs, antivirus scan) and add attachments on items, comments and pages with Uppy resumable uploads, previews for images and PDFs, and per-plan size limits."

**Hardening H4.**
- A user who loses access is disconnected from open collaboration sessions.
- Document and canvas size caps; websocket connection and message rate limits per tenant.
- Collaborative content is sanitised on the server before any export or email.
- Conflict tests for concurrent canvas saves.
- Upload tests: type spoofing, oversized files, malware test file quarantined, signed URLs expire.
- A guard pins the canvas library to the licensed major version.

### Phase 5 — Automation and integrations

#### 5.1 Automation engine and builder (L)
- **Source:** `app-layer/automation`; `RuleBuilderModal`; React Flow; Paca web (Apache-2.0) for the graph builder.
- **Prompt:** "Port the automation bus, rules, executions and action executor. Define the event contract for work items, cycles, comments, intake and integrations. Build a trigger, condition, action builder. Actions: set field, assign, comment, notify, create item, call webhook. Detect and stop rule loops with a per-chain depth limit."
- **Owner decision, 2026-11-18** ("Add it in Phase 6"): 5.1 ships without an action that starts an agent run. Phase 6 adds it once the agent engine and its kill switch exist, in 6.3.

#### 5.2 Public API and webhooks (M)
- **Source:** API-key auth, `webhook-headers.ts`, the audit-stream delivery pattern.
- **Prompt:** "Publish a versioned REST API with scoped API keys, OpenAPI documentation and cursor pagination. Add outbound webhooks with signed payloads, a deterministic idempotency key, retries with backoff, a delivery log and a replay button."

#### 5.3 Source-control integration (M)
- **Source:** `octokit`, `@gitbeaker/rest`; Kaneo's GitHub integration (MIT).
- **Prompt:** "Add GitHub and GitLab integrations: install per workspace, link branches, commits and pull requests to items by key, and move item state on pull-request events through automation rules. Verify webhook signatures and store tokens through field encryption."

#### 5.4 Chat and email (M)
- **Prompt:** "Add Slack and Microsoft Teams: create an item from a message, unfurl item links, notify channels, and reply-to-comment by email. Evaluate the Vercel Chat SDK (MIT) for a shared bot codebase and record the result in an ADR."

#### 5.5 Importers (L)
- **Source:** `jira.js`, `@linear/sdk`, `asana`, `trello.js`.
- **Prompt:** "Build importers for Jira, Linear, Asana, Trello and CSV as resumable background jobs with a dry-run report, field mapping, user matching by email, preserved keys and history where the source exposes them, and idempotent re-runs keyed on source ids."

**Hardening H5.**
- Every outbound request goes through `safeFetch`; a test proves private addresses and DNS rebinding are refused.
- Webhook receivers reject bad signatures and replays.
- Importers tested with a 50,000-item fixture, an interrupted run and a second run; counts reconcile exactly against the dry-run report.
- Automation loop, flood and failing-action tests; per-tenant execution budgets.
- OAuth tokens encrypted at rest and revoked on disconnect.
- API contract tests and rate limits keyed on the verified API key.

### Phase 6 — Agent platform

#### 6.1 Engine port (L)
- **Source:** `src/lib/agentic` (tool-runner, static driver, engine-tools, run store, step recorder, caps, budgets, kill switch), `app-layer/ai/guard`, the driver conformance suite.
- **Prompt:** "Port the agent engine: the static driver and the Tool Runner driver, the engine-neutral tool core, the run store and ledger, run and turn caps, monthly budget, kill switch, the injection and egress guard, and the single-seam Anthropic client with its lint rule. Port the driver conformance suite and make both drivers pass it. Leave the Flue driver, the harness scanner, recertification and audit modules behind. Define no workflows yet."

#### 6.2 MCP server and proposals (L)
- **Source:** `src/lib/mcp` transport, auth and registry; proposal queue usecases and UI.
- **Prompt:** "Port the MCP server on the TypeScript SDK v2 and the 2026-07-28 specification. Write project-management tools: read tools for items, projects, cycles, docs, search and analytics; propose tools for creating and updating items, comments, plans and schedule changes. Port the proposal queue with approve, edit and reject, and its review page. Every tool carries an authorization declaration enforced by lint."

#### 6.3 Agents as delegates (L)
- **Source:** Paperclip (MIT) for checkout locks, budgets and heartbeat; Linear's agent guidelines for the interaction model.
- **Prompt:** "Add the delegate model: `Agent` as an actor separate from `User`, with an accountable human owner; `WorkItem.delegateAgentId` beside the human assignee; `AgentSession` with states pending, active, awaiting input, complete, error and stale; an append-only `AgentActivity` stream shown on the item. Add atomic checkout so two agents never hold one item, per-agent and per-project budgets with hard stops, and invocation by delegation, mention, schedule or automation. Add the automation-rule action that starts an agent run, which 5.1 left out."
- **Owner decision, 2026-11-18** ("Add it in Phase 6"): the automation-rule action that starts an agent run lands here, once the agent engine (6.1) and its kill switch exist.

#### 6.4 Assistant surface (M)
- **Source:** assistant-ui (MIT) or AI Elements (Apache-2.0).
- **Prompt:** "Add the in-product assistant: a side panel and a command-palette entry that answer from the workspace through the engine's read tools, render tool results with Islestone's own components, and turn any suggested change into a proposal. Compare assistant-ui and AI Elements in a short ADR and use one."

#### 6.5 Knowledge index (M)
- **Source:** inflect-compliance knowledge index and embeddings module; pgvector.
- **Prompt:** "Add an embedding index over items, comments and pages in pgvector with row-level security on the embedding table, incremental indexing by job, and hybrid retrieval combining full-text and vector scores. Put the embeddings provider behind an interface with a hosted provider and a local model, selected per tenant residency setting."

#### 6.6 Evaluation and telemetry (M)
- **Source:** inflect-compliance skill evaluation records and mount gate; promptfoo; Langfuse MIT core.
- **Prompt:** "Port skills with their evaluation-record gate. Add promptfoo suites run in CI, traces with OpenTelemetry GenAI attribute names, and a decision log per model call. A skill without a passing evaluation record for its exact text does not mount."

**Hardening H6.**
- Red-team suite for prompt injection through item titles, comments, documents, imported data and tool results; a hostile comment never causes an unapproved write.
- Retrieval isolation: a two-tenant test proves no embedding from one tenant reaches another's answers.
- Kill-switch drill: engaged mid-run, no further model or tool call is made.
- Budget hard stops verified; cost per run recorded and visible.
- A sub-processor register and a data-processing note for every hosted model or embedding provider; a residency setting that refuses external calls.
- No prompt or completion text in logs.

### Phase 7 — AI-native features

Each feature ships as a skill with an evaluation set, writes only proposals, and cites the item ids it relied on.

#### 7.1 Plan generation (L)
- **Source:** spec-kit and BMAD (MIT) for the staged shape; task-master's output shape as reference only.
- **Prompt:** "Add 'plan from a goal': from a goal statement or an uploaded brief, the agent asks clarifying questions, then proposes a breakdown of milestones, items, estimates and dependencies as one reviewable proposal shown as a tree and on the canvas. Approval creates everything in one transaction in the approver's name."

#### 7.2 Triage (M)
- **Prompt:** "Add intake triage: for each new intake item, propose duplicates found by embedding search and rerank, a project, labels, priority and missing-information questions. Record precision and recall in the evaluation set and show the reviewer why each duplicate was suggested."

#### 7.3 Natural-language views (M)
- **Prompt:** "Add natural-language filters: turn a sentence into the existing filter schema through structured output, validate it against the schema, show the resulting filter chips for correction, and let the user save it as a view. A sentence that cannot be expressed is refused with the reason, never approximated silently."

#### 7.4 Digests and risk signals (M)
- **Prompt:** "Add status digests: a deterministic query collects what changed, what slipped and what is blocked for a project and period; a model writes the summary from those facts only, with a link per claim. Add risk signals computed in code (ageing items, blocked chains on the critical path, scope growth, over-allocation), which the digest explains."

#### 7.5 Forecast explanation and rescheduling (L)
- **Source:** Timefold Solver Community (Apache-2.0) as an optional sidecar.
- **Prompt:** "Add 'why is this late' and 'what if': the model explains a forecast from the scheduler's and simulator's own outputs, and proposes a reschedule by stating constraints that the scheduling engine then solves. Evaluate Timefold as a sidecar for resource levelling and record the decision in an ADR. The model never states a date the engine did not compute."

#### 7.6 Meetings to actions (M)
- **Source:** Meetily and anarlog (MIT) for the pipeline shape.
- **Prompt:** "Add meeting notes: upload or paste a transcript, get decisions and action items as proposals linked to existing items where they match. Transcription from audio is a later, separately decided step."

#### 7.7 Islestone inside other assistants (M)
- **Source:** MCP Apps (`modelcontextprotocol/ext-apps`).
- **Prompt:** "Publish Islestone's board and item views as MCP Apps so a customer's assistant can render them interactively, and document how an external coding agent takes a delegated item through the MCP server: checkout, activity updates, linked pull request, hand back for review."

**Hardening H7.**
- Each skill has a minimum evaluation score that gates release, and the suite runs on every change to its text or tools.
- Groundedness check: a digest or explanation with a claim that has no cited item fails.
- Measure approval, edit and rejection rates per skill; a skill whose rejection rate passes a threshold is withdrawn by a brake flag.
- Abuse and cost controls: per-tenant AI budgets, rate limits, and a clear refusal when exhausted.
- User-visible labelling of agent-written content; every agent action traceable to its session.

### Phase 8 — SaaS readiness

#### 8.1 Billing and plans (M)
- **Source:** `lib/stripe.ts`, `lib/billing/`, `lib/entitlements.ts`.
- **Prompt:** "Port billing: plans with seat counts, entitlements enforced at the mutation boundary, metered AI usage, trials, and a self-hosted mode where limits are off. Limits are never enforced in the UI alone."

#### 8.2 Onboarding and templates (M)
- **Prompt:** "Add onboarding: workspace creation, a sample project, template gallery, importer entry point, invite flow and a guided tour. Measure time to first created item."

#### 8.3 Enterprise administration (M)
- **Prompt:** "Finish enterprise administration: SSO and SCIM out of the feature flag, audit-log viewer and streaming, session policy, data export per workspace, retention settings, and tenant deletion with a purge job and a documented retention table for every model."

#### 8.4 Sharing and guests (M)
- **Prompt:** "Add project-level roles, guest access limited to named projects, private projects, and public read-only links for roadmaps and pages with expiry and revocation."

#### 8.5 Reach (M)
- **Prompt:** "Make the product installable as a PWA with a responsive mobile layout for inbox, My Work, item detail and quick capture; complete the accessibility audit to WCAG 2.2 AA; add a second locale to prove the i18n path."

#### 8.6 Documentation and trust (M)
- **Source:** inflect-compliance docs site and policy documents.
- **Prompt:** "Publish a help site and a developer site from allowlisted docs, with API reference generated from the OpenAPI document. Write SECURITY.md, the sub-processor list, the data-processing agreement template, the privacy notice and the incident-response runbook."

**Hardening H8.**
- External penetration test; findings fixed or accepted in writing.
- Load test at the target tenant count; service-level objectives defined with alerts and an on-call runbook.
- Backup restore and disaster-recovery drill with measured recovery time.
- Tenant deletion verified to leave nothing but the retained records listed in the retention table.
- Billing edge cases: failed payment, downgrade over limit, seat removal, refund.
- Run Islestone's own controls through inflect-compliance as the first SOC 2 readiness pass.

### Phase 9 — Launch and after

#### 9.1 Private beta (M)
- **Prompt:** "Prepare the beta: feature flags per cohort, product analytics events for the core loop, an in-app feedback channel that files into Islestone's own intake, and a weekly review of agent approval rates and forecast calibration."

#### 9.2 General availability (S)
- **Prompt:** "Write the launch checklist and verify each line against evidence: hardening gates H0 to H8, status page, support process, pricing page, migration guides from Jira, Linear and Asana."

#### 9.3 After launch (decide then)
- Local-first sync and offline (Zero is the leading candidate; it must fit row-level security).
- Native mobile apps.
- Audio transcription and a voice standup agent.
- A plugin or app platform.
- The move from NextAuth v4 to Better Auth, per ADR 0004.

**Hardening H9.** Staged rollout with a rollback rehearsal; an incident game day; a post-launch review of every alert that fired and every one that should have.

## 6. Order and parallel work

- Phases 0 and 1 are strictly first.
- Phase 2 must finish before 3, 5 and 6. Phase 4 can run beside Phase 3.
- Phase 6 needs Phase 2 and sub-phase 2.7; Phase 7 needs Phases 3 and 6.
- Phase 8 sub-phases 8.1 to 8.4 can start once Phase 2 is done.
- A usable first release is Phases 0 to 2 plus 6.1 to 6.4 and 7.1: a work tracker with a planning agent.

## 7. Completeness review

Checked against the brief and against what a project-management product needs.

| Item | Covered in |
|---|---|
| Research on portable open-source repositories | Section 2, with port, inspiration and avoid verdicts |
| Reuse of the inflect-compliance UI, ticketing, tldraw and agent engines | 1.2, 2.1 to 2.3, 4.2, 6.1 to 6.2 |
| Phases and sub-phases with a prompt each | Section 5: 10 phases, 55 sub-phases |
| Hardening per phase | H0 to H9 |
| Security and tenancy | 1.3 to 1.5, every hardening gate |
| Core tracker features: hierarchy, views, custom fields, cycles, intake, search | Phase 2 |
| Planning: timeline, goals, calendar, time, workload, forecasting | Phase 3 |
| Documents, canvas, realtime, files | Phase 4 |
| Automation, API, integrations, importers | Phase 5 |
| Agent platform and AI features | Phases 6 and 7 |
| Billing, onboarding, enterprise, sharing, mobile, docs | Phase 8 |
| Delivery, environments, launch | 1.8, Phase 9 |

Gaps found in review and how they were closed:

- Templates and recurring items were missing; added to 2.5.
- Deployment and environments were missing; added as 1.8.
- Data export and tenant deletion were missing; added to 8.3.
- Live updates were implied by collaboration but not specified for boards; added as 4.3.
- Forecast honesty on thin history was unstated; added to 3.6 and H3.

Decisions for the owner that the research could not settle. The first three were decided on 2026-11-18 and are recorded in [ADR 0001](adr/0001-code-provenance-and-licences.md):

1. The written BUSL grant from Inflect Ltd. (0.1). **Decided (D1):** copying from inflect-compliance is allowed; every copied file gets a `PROVENANCE.md` row. No separate grant document was produced: the owner's decision, recorded in the ADR, is the authority.
2. The canvas licence path (0.1). **Decided (D3):** tldraw 3.x with the watermark visible.
3. Whether Islestone itself is open source, and under which licence. **Decided (D2):** BUSL-1.1, licensor Inflect Ltd., Change License Apache-2.0; source-available, not open source.
4. Auth: port NextAuth v4 now (recommended, because SSO, MFA and SCIM come with it) or start on Better Auth.
5. Hosting target and data residency regions.
6. Which embeddings provider, since a hosted one is a new sub-processor.
7. Pricing and how AI usage is metered.

Raised after the research and decided on 2026-11-18 (ADR 0001 D4): inflect-compliance's UI layer, which 1.2 copies, is largely derived from Dub (AGPL-3.0) and includes Nucleo icons whose notice forbids redistribution. The owner chose to copy it as is and accept the risk; `NOTICE` names both when `packages/ui` lands.

Limits of the research: star counts, vendor prices and some maintenance claims came from secondary sources. Section 2 states licences as read from LICENSE files on 2026-11-18; re-read each one at the pinned commit before porting, as H0 requires.
