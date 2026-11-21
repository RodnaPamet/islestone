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

### 2.6 Product audits

Proprietary products read for ideas only. Nothing is copied from them, and their product names and branding are not used; Islestone's words come from ADR 0006.

**Procore** (construction management), audited 2026-11-20: [`docs/research/procore-audit.md`](research/procore-audit.md). Its hosts were not reachable, so its facts come from public search summaries and press releases. The owner adopted nine of its ten top ideas on 2026-11-20 (decisions 76 to 84, `docs/HANDOFF.md`); #8 was not adopted separately, because 6.3 and a search skill already plan it. Where each landed:

| Idea | Decision | Where |
|---|---|---|
| Waiting on: whose move it is, apart from the accountable assignee | 76 | 2.4b; My Work section in 2.7; time waiting in 3.6 |
| Field sets: required, optional or hidden fields per work item type | 77 | 2.4b; proposals checked against them in 6.2 |
| Questions with a marked answer, and an agent that drafts cited answers | 78 | 2.4b (type and answer); 7.8 (the agent's skill) |
| Distribution groups: named sets of people to notify | 79 | 2.7; a notify target in 5.1 |
| Review steps: sequential or parallel reviewers, rounds instead of rewinds | 80 | 2.8; conditional steps in 5.1 |
| Checklist runs: templated pass/fail checks whose failures open work items | 81 | 4.5 |
| Periodic structured reports: an agent drafts from computed facts, a person files | 82 | 7.4 |
| Meeting series: agenda, carry-forward of open points, minutes | 83 | 7.6 |
| Project roles for guests and the outside firm they belong to | 84 | 8.4 |

Each needs ADR 0006 rows before its first model or label (rule 1), and two need an ADR 0002 amendment (77 and 80). Those of 76 to 78 were made with 2.4b's decisions (100 to 119, 2026-11-20): ADR 0006's Waiting on, Field set and Answer rows and ADR 0002 §1, §7, §14 and §15. The others are not made yet, and their words are not chosen: each sub-phase lists its proposed words as open questions, decided when it starts. Words already taken that these ideas reach for: "Workflow" (a team's states only, rule 6), "Approve, Edit and approve, Reject" (proposals), "Responsible" (banned for assignee), "Checklist item" (banned for sub-item), "Group" (SCIM's word), "Report" (banned for view), "Company" (banned for organization), "Collaborator" (banned for member), and "Template", "Layout" and "Run", which already name other concepts. Principle 3 and ADR 0003 hold throughout: every tracked piece of work stays a work item, the assignee stays the one accountable person, agents only propose, and an agent never counts as a reviewer.

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
- **Prompt:** "Port authentication: credentials, Google and Microsoft sign-in, session rows with revocation, MFA, password policy with the breach check, invites, and the tenant-access gate in middleware. SSO and SCIM wait for 8.3 (ADR 0004 A2, owner decision 2026-11-19). Write a new `PermissionSet` for project management (workspace, projects, work items, views, cycles, docs, canvas, automations, integrations, agents, billing, admin) with roles OWNER, ADMIN, MEMBER, GUEST and VIEWER, and port `requirePermission` with its denial audit row. Port the guards for membership-creation paths and permission coverage."
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
- **Decided, 2026-11-19 (owner decisions 42 to 47, `docs/HANDOFF.md`):** production only, on `islestone.cloud` and `www.islestone.cloud`, as the Compose project `islestone` on the shared GCP VM `agrent` (with Agrent and Playerz), behind Agrent's Caddy through an imported site file. **The staging environment and the per-pull-request previews in the prompt above are deferred by decision 43**, not built. Delivery is GHCR plus a scoped Watchtower; migrations run in a one-shot `migrate` service (forward fix only); semantic-release versions `main`; Islestone runs its own Postgres, PgBouncer and Redis; the H1 Trivy and ZAP scans start report-only with a dated end. Landed in sub-phase 1.8: see `docs/deployment.md` and `docs/change-management-policy.md`.

**Hardening H1.**
- Two-tenant integration tests prove no read or write crosses tenants on every table, as the application database role.
- Auth abuse tests: lockout, session revocation that actually signs out, invite token burn on mismatch, cross-tenant slug access refused.
- Baseline DAST scan (OWASP ZAP) nightly and blocking; dependency audit and container scan blocking.
- Bundle-size budget per route; a guard that no server env schema reaches the client.
- Accessibility pass (axe) on the shell and every primitive in the gallery.
- A restore of a staging backup performed once and documented. (With no staging environment, decision 43, the drill restores a production backup into a scratch database beside the live one: `RESTORE_DRILL=1 deploy/backup.sh`, `docs/deployment.md`.)

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

#### 2.4b Work-item fields follow-ups (L)
- **Source:** the Procore audit, ideas only (`docs/research/procore-audit.md`, top ideas #1, #2 and #3). No code, text or names taken.
- **Prompt:** "Add three things to the work-item model, as a short series of pull requests in this order. (1) Waiting on: a nullable, versioned field on `WorkItem` naming the one person who must act next, a member (a guest once 8.4 exists), set by hand and cleared when the item closes. It is a column, a filter and a swimlane, follows the `If-Match` rules and is audited like any field change. It is not a second assignee: the assignee stays the one accountable person (ADR 0003 §1), and nothing routes notifications, delegation or proposals by it until a later sub-phase says so. (2) Field sets: for each work item type, which built-in fields and which custom fields are required, optional or hidden. The create and update usecases refuse a write that leaves a required field empty, naming the fields; the forms show and hide fields from the same rules, read from the server, never restated in a component. (3) Questions: a Question type whose field set requires a due date and waiting-on, and a marked answer: a person who may edit the item marks one of its comments as the answer, stored as a pointer from the item to the comment, which moves the item to a Done state of its team and notifies its watchers. Ship a Question item template on 2.5's templates. Every new column is in the migration with its index; every write is validated, authorised, audited and sanitised as in 2.2."
- **Owner decision, 2026-11-20 (Procore audit; decisions 76, 77 and 78).** This sub-phase was added for three adopted ideas. 2.1 to 2.4 have landed, so it is where the next work-item field work picks them up. It runs after 2.5 (the Question template uses 2.5's item templates) and before 2.7 (My Work's "waiting on me" section). The agent that drafts answers to questions is 7.8.
- **Owner decisions, 2026-11-20 (decisions 100 to 119; `docs/porting/maps/2.4b.md`).** All twenty of the map's open questions were decided: every recommendation except question 7. The words are Waiting on (`waitingOnUserId`), Field set (`WorkItemTypeField`, `FieldRequirement`) and Answer (`answerCommentId`). Any active member may be waited on, set under `work_items.edit`, with one in-app bell to the person named; the transition record counts its changes. **Waiting on may name the delegate's agent session from 6.3** (decision 106, option C): in 2.4b people set it by hand, 2.8's review steps set it, a repeat copy takes its source's value, and 6.3 adds a nullable session reference with a CHECK that at most one of the two is set; it never makes anyone or anything accountable (ADR 0003 §1 unchanged). Field sets: built-in rules per type across the workspace (`admin.manage`), custom-field rules per type within the field's project (`projects.edit`); required while open; hidden fields refused on write; machine-made items checked, a refused repeat holding with `FIELD_SET_UNMET`. Questions: deleting or editing the marked answer is refused until it is cleared; marking moves an open item to the first live Done state (a chooser when there are several); Question is not seeded but offered as a Settings preset with a per-project template; the creator of an item whose type shows the answer watches it. Three pull requests: 2.4b-a waiting on, 2.4b-b field sets, 2.4b-c questions.
- **ADR amendments** (applied 2026-11-20 with the decisions):
  - ADR 0002 §1 says "Types carry no behaviour"; field sets give a type behaviour, so §1 is amended, with §7 for how a project's custom fields enter a type's set.
  - ADR 0006 rows for waiting-on, the field set and the marked answer (rule 1).
  - ADR 0003 §1 is not changed: waiting-on never makes anyone accountable, and the assignee stays the one accountable person.
- **Open questions, as the roadmap first listed them** (all decided above):
  1. Words. Waiting on: proposed "Waiting on" (`waitingOnUserId`), "Next to act", "Whose turn"; not Owner, Responsible or Assignee (banned or taken), and "awaiting input" is already an agent session state. Field set: proposed "Field set", "Type fields", "Field rules"; not "Field layout" ("Layout" is a view's list, board, timeline or calendar), Property or Attribute (banned for custom fields). Answer: proposed "Answer" (`answerCommentId`), "Marked answer"; not "Accepted answer" (Accept is a banned synonym of Approve) and not "Reply" as a model (banned for comments).
  2. Where a field set lives: per workspace type, or per project and type (custom fields belong to a project, ADR 0002 §7). What a new rule does to existing items that break it.
  3. Who or what sets waiting-on besides a person: per-state defaults a team configures, review steps (2.8); and whether it may name the delegate's agent session once 6.3 exists (a session awaiting input reads as waiting on the assignee either way).
  4. The marked answer and decision 53: deleting a comment marked as the answer is refused, or clears the mark. Which Done state the item moves to when its team has several. Whether Question is seeded for every new workspace (ADR 0006 open question 6 recommends Feature, Bug, Chore only).

#### 2.5 Cycles, modules, templates and recurrence (M)
- **Prompt:** "Add `Cycle` (time-boxed, per team, automatic rollover of unfinished items by a scheduled job), `Module` or milestone (a scoped group with a target date), project and item templates, and recurring items generated by a job. Each cycle page shows scope, completed, and a burn-up chart."

#### 2.6 Intake and triage (M)
- **Prompt:** "Add an intake stage: public and internal forms built with react-hook-form, an inbound email address per project, and a triage inbox where an item is accepted, declined, merged into a duplicate or snoozed before it reaches the backlog. Rate-limit and sanitise every public entry point."

#### 2.7 Search, inbox and My Work (M)
- **Prompt:** "Add Postgres full-text search over items and comments with a tenant-leading index, searching encrypted description and comment bodies only as the search ADR called for by ADR 0002 section 11 decides, a notification inbox with per-event preferences and digests, mentions, and a My Work page (assigned, created, watching, due soon). Search lives inside the filter popover and the command palette."
- **Owner decision, 2026-11-20 (Procore audit; decision 76).** My Work gains a section of the items waiting on me (2.4b's field), as a read of the shared list query like the other four. Whether the due-date reminders also go to the person an item waits on was decided when 2.7 started: they do (decision 137); the assignee keeps getting them.
- **Owner decision, 2026-11-20 (Procore audit; decision 79): distribution groups.** Named sets of members (guests once 8.4 exists), per workspace or per project, that a person adds to an item's watchers in one step, and that later features name as recipients: review steps (2.8), checklist records (4.5), automation notify actions (5.1), filed reports (7.4) and meeting minutes (7.6). Each member's notification preferences (this sub-phase) and project visibility still apply, re-checked at send time with the workspace-liveness check (`tests/guards/cross-tenant-recipient-liveness.test.ts`). The new tables follow the tenant-table rules (RLS, tenant-leading index, two-tenant test in `ISOLATION_TESTED`).
  - ADR amendments it needs: an ADR 0006 row before the first model or label. Nothing in ADRs 0002 or 0003 changes: a group only notifies, it never assigns.
  - Open questions, decided when it started (decisions 138 to 140): the word (proposed "Recipient list", "Distribution list", "Audience"; not "Group", which is SCIM's word, "Team", which is taken, or "List" alone, a layout); whether adding a group to an item copies its members as watchers at that moment or follows the group as it changes; who manages workspace and project groups (`admin.manage`, `projects.edit`, or a key of their own).
- **Owner decisions, 2026-11-20 (decisions 124 to 144; `docs/porting/maps/2.7.md`).** All twenty-one of the map's open questions were decided: every recommendation except questions 1 to 3 and the word in question 20.
  - **Search (ADR 0008, Accepted).** Encrypted descriptions and comments are searched through a **plaintext `tsvector` full-text index** (decision 124, option C, S2): the owner confirmed it knowing the searchable words of descriptions and comments are readable in Postgres, its dumps and the off-host backups. Indexed: titles, keys, project names, descriptions and live comments. Never indexed: intake request bodies and answers, encrypted template text, project-template content and every `PII_FIELD_MAP` field. The vectors (`SearchVector`) are written by the usecase in the text's transaction, removed with their comment, item or workspace, and rebuilt by a job; the encryption-manifest guard classifies them as a deliberate plaintext derivative. The token key is moot (decision 125). **Stemming is Bulgarian and English** (decision 126, revised by the owner): one custom configuration, `islestone_bg_en`, with the open-source Bulgarian Hunspell dictionary for Cyrillic words and Postgres's `english_stem` for Latin ones, installed in Islestone's own Postgres image; 2.7f pins the dictionary's licence (`PROVENANCE.md`, `NOTICE`), builds the image for production, CI and local use, and fails closed without it.
  - **Mentions:** a `<@userId>` token from a picker in plain text, rendered as a chip; it notifies and adds a watcher; machine-made text never mentions; the notification never carries the text; keys render as links at display (decisions 127 to 131).
  - **Inbox:** per-type preferences (in-app; email off, immediate or daily), one daily digest at 08:10 replacing the due digest, Unread / All / Done, Done purged after 90 days and read after 180, Settings → Notifications for admins (decisions 132 to 136).
  - **Waiting on:** due reminders also go to the person an item waits on, same windows and type, "waiting on you", unassigned items included, never twice to one person (decision 137).
  - **Distribution groups are Recipient lists** (decision 138): copied into watchers when added, workspace lists under `admin.manage` and project lists under `projects.edit`, archive-only, and intake's notify list may name one (decisions 139 to 142).
  - ADR 0006 rows Notification preference, Digest, Mention, Recipient list and Search vector, and Done as the Inbox's archive verb (decision 143). Six pull requests, 2.7a to 2.7f in the map's order (decision 144).

#### 2.8 Reviews (L)
- **Source:** the Procore audit, ideas only (`docs/research/procore-audit.md`, top idea #5). No code, text or names taken.
- **Prompt:** "Add review steps to work items. An item may carry an ordered list of steps. Each step names its reviewers (members, or a distribution group from 2.7), says whether all or any of them must respond, and has a due date in working days. While a step is open, the item waits on its reviewers who have not responded (2.4b's waiting-on); when the step completes, the next one opens, and after the last the item waits on its assignee again. A reviewer responds with one of two outcomes and an optional comment. A returned step closes the round and opens a new round of the same steps: the earlier round's steps and responses stay as they were, read-only, and nothing is rewound or deleted. Default steps per work item type, set by an admin, are copied onto an item when it is created. Only people respond: an agent never counts as a reviewer and never responds to a step; at most a delegate drafts a review comment as a proposal that a reviewer approves as their own. Every response is audited, every route is a literal `requirePermission`, and notifications go through the shared bell and email writers. Conditional steps (add a step when a field passes a value) wait for 5.1's conditions."
- **Owner decision, 2026-11-20 (Procore audit; decision 80).** This sub-phase was added for review steps. It runs after 2.4b (waiting-on) and 2.7 (distribution groups), and does not hold up Phases 3, 5 or 6 (section 6). Review steps belong to work items: no table per kind of record (principle 3), and the assignee stays the one accountable person whatever a step says (ADR 0003 §1). It is the human counterpart of the proposal queue (6.2), not part of it: a proposal reviews an agent's change, a review step reviews a person's work.
- **ADR amendments** (made with the decisions below): ADR 0009 "Review steps" (Accepted), which ADR 0002 §1, §3 and §14 point to; ADR 0003 §4 gains "an agent never reviews"; ADR 0006 gains the rows Review step, Round, Reviewer and Review outcome.
- **Owner decisions, 2026-11-20 (decisions 148 to 165; `docs/porting/maps/2.8.md`, open questions 1 to 18).** Every recommendation was accepted except questions 11 and 15:
  - **Words:** Review step, Round, Reviewer; outcomes Signed off and Returned; My Work's section "To review" (148).
  - **An indicator by default;** a work item type may require its review to finish before Done; cancelling is never held; closing an item withdraws an open round (149; the Done check ships in 2.8c).
  - Anyone with `work_items.edit` edits steps not yet opened; skipping a step, or closing one whose reviewers left, takes the assignee, whoever sent the round, or an admin, audited (150). Working days are Monday to Friday, no holidays, computed when a step opens and stored (151).
  - **Waiting on stays one person:** while a round is open the item waits on the open step's pending reviewers, read from their rows; the column is cleared when a round opens and names the assignee when it ends; setting it by hand while a round is open is refused, 409 `REVIEW_ROUND_OPEN`, and 6.3's session reference follows the same rule (152, 153).
  - A recipient list is resolved when its step opens (154); a round starts only on "Send for review", also after a Return (155); one Return returns an "all" step at once (156); the response text is its own encrypted text, required to Return, not searched, without mentions, never removed by an admin (157).
  - **Reviewers (158, the owner's choice B):** any active member who sees the project, Viewers included, but **never the item's assignee** (separation of duties; a one-person team cannot review its own work), refused when steps are edited and when responding; an assignee change that makes a pending reviewer the assignee withdraws their row.
  - Default steps per type, workspace-wide under `admin.manage`, copied by every create path and never opened (159; 2.8c). No new permission domain (160). Four notification types, immediate email offered for requested and returned (161).
  - **A response is changeable until its step completes (162, the owner's choice B),** then frozen with the step; an ended round is never rewritten. The item stays editable; each response records the item's version (163). ADR 0009 (164). Three pull requests: 2.8a rounds, steps and responses; 2.8b the item detail and My Work; 2.8c defaults per type and the Done check (165).

**Hardening H2.**
- Performance: seeded tenants at 10,000 and 100,000 items; list, board and search stay under an agreed response budget; no query in a loop; every list query has a backing index (port the index and query-shape guardrails).
- Concurrency tests for reordering, key allocation and bulk updates under parallel writers.
- A permission matrix test: every role against every work-item route, including guests limited to their projects, and the review-step routes once 2.8 lands.
- A required field (2.4b) is refused by the usecase for an API caller that skips the form; an earlier review round (2.8) is never rewritten by a later one.
- Drag and drop passes keyboard and screen-reader checks.
- Public forms and email intake fuzzed for injection, oversized bodies and floods.
- End-to-end tests run in isolated tenants; no shared mutable state between tests.
- **Owner decisions, 2026-11-20 (decisions 166 to 181; `docs/porting/maps/H2.md`, open questions 1 to 16).** Every recommendation was accepted:
  - **Performance:** budgets measured on a stated reference machine (GitHub's standard Linux runner with Islestone's Postgres image, PgBouncer and the built app) against the map's per-surface table (166, 167); deterministic checks (plans use their indexes, statements per request, a run that measured something) block every pull request at 10,000 items, latency blocks only the nightly 100,000 run with 25 % tolerance and one re-run, and a red night opens an issue (168); an in-house Node load script (169); realistic seeds with a 20,000-item project and a sibling workspace (170), 1 % written through the application and the rest in bulk SQL with real encryption and database-computed search vectors, cached as a dump (171); what H2 finds is fixed before the gate closes (172).
  - **Concurrency:** every bulk change and every other write that touches several work items locks its items in id order before it plans from the locked rows, fixing issue #65's deadlock and stale audit "from" value (173); 25 simultaneous creates in one project are supported and tested (174).
  - **Permissions:** the matrix covers Owner, Admin, Member, Viewer, Guest and two custom roles from a hand-written table every new route joins (175); a guest sees nothing until 8.4, and its cells are tagged to fail when 8.4 arrives (176).
  - **Accessibility, fuzzing, isolation:** browser accessibility checks (`@axe-core/playwright`, dev-only) plus a scripted NVDA and VoiceOver pass per gate (177); property fuzzing of the intake parsers in the normal run, 20,000 cases nightly, route-level injection, oversize and flood tests, the public form pages in the nightly passive scan (178); two end-to-end isolation guards, a fixed "today" and a nightly double run with no retries (180).
  - **Delivery:** parts merge as ready and the gate closes after 2.8c (179); seven pull requests plus one for the 2.8 parts (181).

### Phase 3 — Planning, time and forecasting

#### 3.1 Timeline and critical path (L)
- **Source:** SVAR React Gantt MIT core; the gantt chart primitive in inflect-compliance.
- **Prompt:** "Add a timeline view using SVAR React Gantt (MIT core only; import nothing from PRO). Write the scheduling engine in-house as a pure module: forward and backward pass over the dependency graph, float, critical path, working calendars and holidays. The engine takes plain data and returns plain data, with no database access. Dragging a bar creates a change the user confirms."
- **ADR amendments** (made with the decisions below): ADR 0010 "Scheduling and working calendars" (Accepted); ADR 0002 §6 (blocks read as finish-to-start, no lag) and §16 (the project's due date); ADR 0006 gains the rows Working calendar, Holiday, Critical path, Float, Earliest and latest dates, Deadline and Change dates; ADR 0009 §13 (review working days from working calendars).
- **Owner decisions, 2026-11-20 (decisions 182 to 203; `docs/porting/maps/3.1.md`, open questions 1 to 22).** Every recommendation was accepted except questions 7, 13 and 18:
  - **The library:** SVAR React Gantt 2.8.3, MIT core only (182). Its MIT notice travels only in the licence files installed with its packages: no generated notices file and no `NOTICE` section (**199, the owner's choice C**); recorded as a known risk that the MIT licence asks for its notice in "all copies or substantial portions" and the minified browser bundle carries none. No licence policy or gate changes.
  - **The engine:** only "blocks", as finish-to-start with no lag (183); conflicts reported, stored dates never moved (184); missing dates count as one working day or go to a "No dates" list, and a chain through an undated item is flagged (185); a parent is a summary bar (186); done items fixed at their actual dates, cancelled ones left out, nothing unstarted before today (187); computed on the server and by the same module in the browser for drag previews (197); the critical path is the least float in view (198).
  - **Deadlines (188, the owner's choice C):** a milestone's due date is a deadline for its items, **and each project gains its own due date** (`Project.dueDate`), a deadline for all its items, set on the project's create and edit, carried by project templates as an offset, moving nothing and ringing nothing.
  - **Working calendars:** a workspace calendar plus an optional calendar per team (189); holidays by hand with "Copy last year's" (190); each calendar has its own time zone, defaulting to `NOTIFICATIONS_TZ`, while the nightly jobs stay on `NOTIFICATIONS_TZ` (191); review steps opened after 3.1 count on calendars and stored due dates never move (192); managed under `admin.manage` (193).
  - **The timeline:** the drag confirmation offers **"Also move the N items it pushes later"**, a bulk change of dates in the same confirmation, all or nothing, items locked in id order, later moves only, at most 100, held behind the undo toast (**194, the owner's choice B**); dependencies drawn through a confirmation, removed through the undo toast (195); at most 5,000 items, never a cut-off list (196); a schedule table beside the chart ("Chart / Table") as the accessible way to use it (203).
  - ADR 0010 and the amendments (200); the proposed words (201); three pull requests, 3.1a the engine, working calendars and the project's due date, 3.1b the read-only timeline, 3.1c changes from the timeline (202).

#### 3.2 Goals, initiatives and roadmaps (M)
- **Source:** Paperclip (MIT) goal schema for ancestry.
- **Prompt:** "Add `Goal` and `Initiative` above projects, with progress rolled up from child items and a health status set by a person. Every work item can answer its ancestry in one query. Add a roadmap view across projects and a portfolio page per initiative."
- **ADR amendments** (made with the decisions below): ADR 0002 §2 (the chain plus a work item's direct goal, health and the lifecycle) and a new §17 (goals, initiatives and progress, archive, soft delete and the purge); ADR 0006 gains the rows Health, Lead, Goal status, Initiative status, Progress and Ancestry, and its Goal and Roadmap rows are amended. No new ADR.
- **Owner decisions, 2026-11-21 (decisions 205 to 224; `docs/porting/maps/3.2.md`, open questions 1 to 19 and one on purging).** Every recommendation was accepted except questions 1, 7, 11, 13, 14 and 17:
  - **Words and states:** health values On track, At risk, Off track and **Completed**, plus "No health set" (**205, the owner's choice B**), a person's judgement independent of the status, on goals and initiatives (206), with no written update (207); the lifecycle Planned, Started, Completed, Cancelled for both (208); an optional Lead, Viewers included (209); optional due dates that are not engine deadlines (210).
  - **Structure:** the chain stays goal → initiative → project, and **a work item may also name one goal directly** (`WorkItem.goalId`), set under `work_items.edit`, a configurable field, kept on moves, counted once per goal and matched by the `goalId` filter (**211, the owner's choice**); progress counts archived projects' items (212).
  - **Permissions:** a new `goals` domain (213); health set by a person only (214).
  - **The roadmap:** a bar is derived, never stored: a project's the scheduling engine's span of its items' dates, an initiative's the span of its projects, a scope with no dates in a "No dates" list (**215, the owner's choice**); SVAR through 3.1's adapter (216); read-only, but **a bar opens 3.1's timeline** scoped to that initiative's or project's items (**217, the owner's choice**).
  - **Lifecycle and pages:** **soft delete with restore** (a goal's delete takes its child goals and initiatives in one group; links kept while deleted), archive for Completed and Cancelled ones (**218, the owner's choice**), and a nightly purge after 30 days clearing links with `SET NULL` (219); the breadcrumb, the ancestry route and the `goalId` and `initiativeId` filters (220); the portfolio page is the initiative's page (221); **one sidebar entry named Roadmap** with three pages, Goals, Initiatives and Roadmap (**222, the owner's choice of name**).
  - **Delivery:** three pull requests, 3.2a the model with the item's goal, soft delete and the purge, 3.2b progress, health and the pages, 3.2c the roadmap (223); ADR 0002 and 0006 amended (224).

#### 3.3 Calendar (M)
- **Source:** inflect-compliance calendar usecases and user calendar connections.
- **Prompt:** "Port the calendar surface: a calendar view of items, cycles and milestones, and two-way sync of due dates to Google and Microsoft calendars through the ported connection model. Event titles pushed outside carry item titles only."
- **ADR amendments** (made with the decisions below): ADR 0011 "External calendar sync" (Accepted); ADR 0006 gains the rows Calendar connection, Synced event and Calendar sync settings.
- **Owner decisions, 2026-11-21 (decisions 225 to 244; `docs/porting/maps/3.3.md`, open questions 1 to 20).** Every recommendation was accepted except questions 3, 5 and 12:
  - **What syncs:** due dates pushed, only a moved day read back (225); the person's open assigned items (226); **the milestones of their projects as read-only events**, a moved one undone with a notification (**227, the owner's choice B**); a separate "Islestone" calendar (228); **the title plus an absolute link back** (**229, the owner's choice B**), private and free.
  - **Conflicts:** Islestone wins unless its date is the one last pushed, a losing change undone with one in-app notification (230); a timed or multi-day event means its last day (231); a deleted event stops that item syncing (232); pushed within a minute, read every 15 minutes (233).
  - **Who and how:** an Owner or Admin switch behind the operator's (234); anyone who sees work items connects, Viewers as a read-only feed (235); **the sign-in apps reused** for calendar, through a hand-written flow outside the auth library's seam asking only the calendar scope, and Google's revoke endpoint never called (**236, the owner's choice B**); inflect's Microsoft admin consent (237); tokens in the encryption manifest (238); a leaving member's events deleted before the token (239); Google and Microsoft listed as sub-processors (240).
  - **The view and delivery:** moves through 3.1c's "Change dates" (241); inflect's month grid (242); the names and ADR 0011 (243); three pull requests, 3.3a the view, 3.3b connections, the push and milestone events, 3.3c the read-back (244).

#### 3.4 Time tracking (M)
- **Prompt:** "Add time entries (timer and manual), estimates in points or hours per team, timesheets with weekly approval, and a billable-rate cascade of project, member, workspace. Write it fresh; the open-source time trackers are AGPL and are reference reading only."

#### 3.5 Workload and capacity (M)
- **Prompt:** "Add member capacity (hours per week, time off) and a workload view showing allocation against capacity per person per week, with over-allocation flagged. Read-only suggestions for now; no automatic levelling."

#### 3.6 Analytics and forecasting (L)
- **Source:** `bitovi/jira-auto-scheduler` (MIT) for the Monte Carlo approach.
- **Prompt:** "Add analytics: cycle time, lead time, throughput, cumulative flow, burn-up. Add a forecasting module, pure and seeded, that runs Monte Carlo simulation over historical throughput to give a completion-date distribution for any scope, shown as dates at 50, 85 and 95 percent. Refuse to forecast with fewer than a stated minimum of completed items and say so. Add a configurable dashboard on the ported dashboard grid."
- **Owner decision, 2026-11-20 (Procore audit; decision 76).** Analytics count the time items spent waiting on each party (2.4b's waiting-on): per person and, once 8.4 tags guests with their firm, per firm. It reads the field's recorded changes, never a guess from its current value.

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

#### 4.5 Checklists (M)
- **Source:** the Procore audit, ideas only (`docs/research/procore-audit.md`, top idea #6). No code, text or names taken.
- **Prompt:** "Add checklists. A checklist definition is an ordered list of checks in sections; each check takes a result of pass, fail or not applicable, an optional note, and an optional evidence requirement (a file from 4.4). Running a definition against a project, or against one work item, creates a record of that run; changing the definition later never changes a past record. A failed check opens a work item linked back to the record and the check, and a check marked so cannot be saved as failed without one. A section may need a named person's sign-off before later sections open. A completed record is read-only, and a PDF of it goes to a distribution group (2.7) through the outbox. The new tables follow the tenant-table rules; notes are sanitised and, where they can hold personal data, encrypted through the manifest. An agent may later pre-fill results from evidence as proposals (Phase 7); a person completes the record."
- **Owner decision, 2026-11-20 (Procore audit; decision 81).** This sub-phase was added for checklists, after 2.5 (templates), 2.7 (distribution groups) and 4.4 (files for evidence). Principle 3 holds: a checklist record is not a second kind of tracked work, and anything it asks someone to do is a work item. Uses beyond construction: release checklists, onboarding, QA passes, launch readiness.
- **ADR amendments it needs before its first model** (none made yet): ADR 0006 rows for the definition, the check, its result, the record of a run and the sign-off. ADR 0002 is not changed while checks stay outside `WorkItem`; it is, if a check ever becomes a work item.
- **Open questions, decided when it starts:**
  1. Words. Proposed "Checklist", "Check", "Check result", "Checklist record" or "Walkthrough", "Sign-off point". Not "Checklist item" (banned for sub-item), not "Template" (2.5's project and item templates), not "Run" (an agent run's label) or "Execution" (automation's).
  2. Whether a sign-off stores a drawn signature (personal data, under the encryption and PII rules) or a recorded acknowledgement by the signed-in person.
  3. Definitions per workspace, per project, or both; the permission keys for defining, running and signing.

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
- **Owner decision, 2026-11-20 (Procore audit; decisions 79 and 80).** The notify action can name a distribution group (2.7), with each member's preferences and project visibility re-checked at send time. Review steps (2.8) gain conditional steps through the builder's conditions: a step added when a field passes a value. An automation never responds to a review step.

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
- **Owner decision, 2026-11-20 (Procore audit; decision 77).** A proposal is checked against its type's field set (2.4b) when it is made: one that would leave a required field empty is refused at propose time, as the usecase would refuse it at approval.

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
- **Owner decision, 2026-11-20 (Procore audit; decision 82): periodic structured reports.** A project can have a report definition (daily, weekly or per cycle) with sections of three kinds: sections computed by code (completed, started, blocked, slipped, time logged from 3.4, items opened from checklists in 4.5), sections people fill, and sections guests contribute once 8.4 exists. An agent drafts the free-text summary from the computed sections only, with a link per claim, and flags missing or conflicting entries, as a proposal. A person finalises the report, which files a read-only record and sends it to a distribution group (2.7). This turns the digest into a filed record a person answers for (principle 4): the model never states a number the code did not compute, and H7's groundedness check applies.
  - The filed record itself, without the agent, may land earlier, after 3.4 and 3.6, as its own pull request; decide when 7.4 starts.
  - ADR amendments it needs: an ADR 0006 row before the first model or label. "Report" is a banned synonym for View, so either pick another word or amend View's row to free it.
  - Open questions, decided when it starts: the word (proposed "Status report", if View's row is amended; otherwise "Briefing" or "Bulletin"; not "Digest", which already names the notification digest, and not "Template" for the definition); whether a filed record can be corrected by a new version or never changes; who may finalise (the project's admins, or a named person per definition).

#### 7.5 Forecast explanation and rescheduling (L)
- **Source:** Timefold Solver Community (Apache-2.0) as an optional sidecar.
- **Prompt:** "Add 'why is this late' and 'what if': the model explains a forecast from the scheduler's and simulator's own outputs, and proposes a reschedule by stating constraints that the scheduling engine then solves. Evaluate Timefold as a sidecar for resource levelling and record the decision in an ADR. The model never states a date the engine did not compute."

#### 7.6 Meetings to actions (M)
- **Source:** Meetily and anarlog (MIT) for the pipeline shape.
- **Prompt:** "Add meeting notes: upload or paste a transcript, get decisions and action items as proposals linked to existing items where they match. Transcription from audio is a later, separately decided step."
- **Owner decision, 2026-11-20 (Procore audit; decision 83): meeting series.** A meeting record belongs to a series, with an agenda whose points link to work items. Points left open carry into the series' next meeting automatically. Minutes are kept per meeting and sent to a distribution group (2.7). New actions become work items, or, from a transcript, proposals (this sub-phase's prompt), so a transcript's proposals have a meeting to belong to and a history.
  - The meeting record, agenda and carry-forward may land first as their own pull request, after 4.1 (pages) and 2.7, ahead of the transcript work; decide when 7.6 starts. Transcript text is new encrypted content; audio stays deferred (9.3).
  - ADR amendments it needs: ADR 0006 rows before the first model or label. Principle 3 holds: a meeting is a record, and the work it creates is work items.
  - Open questions, decided when it starts: the words (proposed "Meeting", "Meeting series", "Agenda point", "Minutes"; not "Agenda item", since "item" is a work item's short label, not "Note" or "Meeting notes" as a model, since "Note" is banned for pages and comments, and not "Session" unqualified); whether minutes are a page (4.1) or a field of the meeting; who may edit minutes once sent.

#### 7.7 Islestone inside other assistants (M)
- **Source:** MCP Apps (`modelcontextprotocol/ext-apps`).
- **Prompt:** "Publish Islestone's board and item views as MCP Apps so a customer's assistant can render them interactively, and document how an external coding agent takes a delegated item through the MCP server: checkout, activity updates, linked pull request, hand back for review."

#### 7.8 Drafted answers (M)
- **Source:** the Procore audit, ideas only (`docs/research/procore-audit.md`, top idea #3, its agent part). No code, text or names taken.
- **Prompt:** "Add answer drafting for Question items (2.4b). When a question is created or delegated, the agent searches the knowledge index (6.5) and drafts an answer that cites the item, page and file ids it relied on, submitted as a comment proposal. Approving it posts the comment as the approver's own reply; marking a comment as the answer stays a person's act and is never proposed. A draft with a claim that cites nothing fails the groundedness check (H7). Starting the agent on new questions uses 6.3's invocation by automation. Such a session was not started by the item's assignee, so it proposes at every rung (ADR 0003, decision 15). Ship the skill with an evaluation set measuring citation precision and the share of drafts approved without edits."
- **Owner decision, 2026-11-20 (Procore audit; decision 78).** This sub-phase was added for the agent part of questions. It needs 2.4b, 6.3 and 6.5. ADR 0003 holds unchanged: the assignee stays accountable for the answer, and the agent only proposes. Needs no ADR amendment beyond 2.4b's answer row.

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
- **Prompt:** "Finish enterprise administration: port SSO (SAML and OIDC, with Enforce SSO) and SCIM (ADR 0004 A2), audit-log viewer and streaming, session policy, data export per workspace, retention settings, and tenant deletion with a purge job and a documented retention table for every model."

#### 8.4 Sharing and guests (M)
- **Prompt:** "Add project-level roles, guest access limited to named projects, private projects, and public read-only links for roadmaps and pages with expiry and revocation."
- **Owner decision, 2026-11-20 (Procore audit; decision 84).** Three additions for outside people:
  - **Project roles per area.** For each area (work items, pages, files, canvas, reports), a level of none, read, contribute or manage, chosen when a guest is invited to a project. Build them on the `PermissionSet` and the `TenantCustomRole` patterns; no parallel system of permission templates.
  - **A grantable subset**: the project roles a project's admins may hand out, as `ASSIGNABLE_TENANT_ROLES` limits the workspace roles a writer may grant.
  - **The guest's firm**: a tag on a guest naming the outside firm they belong to, so an item can wait on that firm (2.4b) and analytics and reports can group by it (3.6, 7.4).
  - `visibleProjects` stops returning none for GUEST here, and H2's permission matrix gains the project roles. The assignee rule is unchanged: a guest is assigned only items in projects they can access (ADR 0003 §1).
  - ADR amendments it needs: ADR 0006 rows for the project role, the grantable subset and the firm, before the first model or label.
  - Open questions, decided when it starts: the words. For the firm, proposed "Firm", "Affiliation" or "Partner"; not "Company", "Account" or "Enterprise" (banned for organization), "Organization" (taken), "Collaborator" (banned for member), "Team" (taken) or "Group" (SCIM's). For project roles, proposed "Project role" and "Grantable roles"; not "Permission template" ("Template" is 2.5's, and ADR 0006 keeps "Permissions" out of identifiers), "Access level" or "Permission level" (banned for role). Also: whether a firm is a workspace-level record shared across projects, and whether members (not only guests) can carry one.

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
- The sub-phases added on 2026-11-20 from the Procore audit (decisions 76 to 84, section 2.6):
  - Inside Phase 2: 2.4b runs after 2.5 and before 2.7, and 2.8 after 2.4b and 2.7. 2.4b follows 2.5 despite its number, because its Question template uses 2.5's item templates.
  - 2.8 (reviews) does not hold up Phases 3, 5 or 6 and is not needed for the first release: "Phase 2 must finish" above means 2.1 to 2.7. Its conditional steps wait for 5.1.
  - 4.5 (checklists) needs 2.5, 2.7 and 4.4.
  - 7.8 (drafted answers) needs 2.4b, 6.3 and 6.5. The additions to 7.4 and 7.6 may land their records earlier, as each says.

## 7. Completeness review

Checked against the brief and against what a project-management product needs.

| Item | Covered in |
|---|---|
| Research on portable open-source repositories | Section 2, with port, inspiration and avoid verdicts |
| Reuse of the inflect-compliance UI, ticketing, tldraw and agent engines | 1.2, 2.1 to 2.3, 4.2, 6.1 to 6.2 |
| Phases and sub-phases with a prompt each | Section 5: 10 phases, 59 sub-phases (2.4b, 2.8, 4.5 and 7.8 added on 2026-11-20) |
| Hardening per phase | H0 to H9 |
| Security and tenancy | 1.3 to 1.5, every hardening gate |
| Core tracker features: hierarchy, views, custom fields, cycles, intake, search | Phase 2 |
| Planning: timeline, goals, calendar, time, workload, forecasting | Phase 3 |
| Documents, canvas, realtime, files | Phase 4 |
| Automation, API, integrations, importers | Phase 5 |
| Agent platform and AI features | Phases 6 and 7 |
| Billing, onboarding, enterprise, sharing, mobile, docs | Phase 8 |
| Delivery, environments, launch | 1.8, Phase 9 |
| Ideas adopted from the Procore audit (2026-11-20) | Section 2.6: 2.4b, 2.7, 2.8, 3.6, 4.5, 5.1, 6.2, 7.4, 7.6, 7.8, 8.4 |

Gaps found in review and how they were closed:

- Templates and recurring items were missing; added to 2.5.
- Deployment and environments were missing; added as 1.8.
- Data export and tenant deletion were missing; added to 8.3.
- Live updates were implied by collaboration but not specified for boards; added as 4.3.
- Forecast honesty on thin history was unstated; added to 3.6 and H3.

Decisions for the owner that the research could not settle. The first three were decided on 2026-11-18 and are recorded in [ADR 0001](adr/0001-code-provenance-and-licences.md); the fourth was decided on 2026-11-19 and is recorded in [ADR 0004](adr/0004-authentication-path.md):

1. The written BUSL grant from Inflect Ltd. (0.1). **Decided (D1):** copying from inflect-compliance is allowed; every copied file gets a `PROVENANCE.md` row. No separate grant document was produced: the owner's decision, recorded in the ADR, is the authority.
2. The canvas licence path (0.1). **Decided (D3):** tldraw 3.x with the watermark visible.
3. Whether Islestone itself is open source, and under which licence. **Decided (D2):** BUSL-1.1, licensor Inflect Ltd., Change License Apache-2.0; source-available, not open source.
4. Auth: port NextAuth v4 now (recommended, because SSO, MFA and SCIM come with it) or start on Better Auth. **Decided (ADR 0004 A1, A2):** port NextAuth v4, pinned exactly, with exit criteria for a later move to Better Auth. SSO and SCIM wait for 8.3; 1.4 ports credentials, Google, Microsoft, sign-in sessions, MFA and invites.
5. Hosting target and data residency regions.
6. Which embeddings provider, since a hosted one is a new sub-processor.
7. Pricing and how AI usage is metered.

Raised after the research and decided on 2026-11-18 (ADR 0001 D4): inflect-compliance's UI layer, which 1.2 copies, is largely derived from Dub (AGPL-3.0) and includes Nucleo icons whose notice forbids redistribution. The owner chose to copy it as is and accept the risk; `NOTICE` names both when `packages/ui` lands.

Limits of the research: star counts, vendor prices and some maintenance claims came from secondary sources. Section 2 states licences as read from LICENSE files on 2026-11-18; re-read each one at the pinned commit before porting, as H0 requires.
