# circle study

Study of `github.com/ln-dev7/circle` for Islestone roadmap sub-phase 2.3 (list, board and detail views), with notes for the neighbouring sub-phases it touches. Read on 2026-11-18. Nothing in the clone was run, installed or built; every fact below comes from reading files, plus `git ls-remote` and `raw.githubusercontent.com` / `registry.npmjs.org` reads for upstream licences.

## 1. Pin and licence facts

| Fact | Value | How verified |
|---|---|---|
| Repository | `github.com/ln-dev7/circle` | clone at `oss-pins/circle/repo` |
| Commit studied | `b0ba7ddcc3d0f4c16092236ca6a01b56c0614810` (2026-09-04, "LNUI-1000: a fully loaded showcase issue for screenshots") | `git log -1` |
| Still HEAD on 2026-11-18 | yes | `git ls-remote https://github.com/ln-dev7/circle HEAD` returned the same hash |
| Licence | **MIT**, file `LICENSE.md` (21 lines), copyright line `Copyright (c) 2025 lndev-ui \| Circle Template` | read at the pinned commit |
| Licence history | `LICENSE.md` has one commit, `f3418bc` (2025-03-05, the initial commit); unchanged since | `git log -- LICENSE.md` |
| Other licence files | none (no NOTICE, no per-directory LICENSE, no CLA/DCO) | `git ls-files \| grep -i licen` |
| Copyleft / source-available markers | none in source (`git grep` for GPL, LGPL, MPL, Commons Clause, BUSL, SSPL, Elastic, "all rights reserved", proprietary: only a binary match in `public/banner.png`) | `git grep` |
| Restricted directories | none, as given; confirmed — the whole tree is MIT or MIT-licensed third-party code | — |
| History | 185 commits, 6 author identities (one maintainer with two identities, three outside contributors, the Vercel bot) | `git log` |
| Size | 356 tracked files; about 41,400 lines of TS/TSX/CSS, of which 10,609 are fake data in `mock-data/` | `wc -l` |

**What circle is.** A pure front-end template: Next.js 15.2.8 App Router, React 19, Tailwind 4, shadcn/ui on Radix, Zustand 5 for in-memory state, nuqs 2 for URL state, react-dnd, recharts, motion, cmdk 1.0.0, react-resizable-panels, sonner. **No backend, no API, no database, no auth** (`AI_GUIDE.md` lines 6-9, `llms.txt` line 3). Its "data model" is TypeScript interfaces next to fake data, not tables.

**A paid sibling exists and is out of scope.** `README.md` and the sidebar footer point to a "BaseUI" version sold on Square UI Pro (`pro.lndevui.com/templates/circle-baseui`). It is not in the repository and is commercial; Islestone must not obtain or read it for this purpose.

### Third-party code vendored inside circle (separate copyright holders)

The single MIT copyright line in `LICENSE.md` does not name these authors, so any copy needs their own notice.

| Path | Lines | Upstream | Upstream licence (read 2026-11-18) | Notes |
|---|---|---|---|---|
| `components/data-table-filter/` (22 files) | 4,184 | bazza/ui data-table-filter, `github.com/kianbazza/ui` | MIT, `Copyright © 2025 Kian Bazarjani` — `LICENSE.md` at upstream HEAD `fe486a6a2ee1779482c0696b5a7008de6039983b` | Named "vendored bazza/ui" in `eslint.config.mjs` line 15 and `AI_GUIDE.md`; files carry no licence header. **The upstream commit the copy was taken from is not recorded in circle — unverified.** |
| `components/ui/` (33 files) | 3,084 | shadcn/ui generated components | MIT, `Copyright (c) 2023 shadcn` — `LICENSE.md` at `shadcn-ui/ui` HEAD `968d8cb9dc42ae5d52e8fd356cf84596ec832a26` | `components.json` is the shadcn config. |
| `components/data-table-filter/hooks/use-unmount.tsx`, `use-debounce-callback.tsx` | 18 + 67 | usehooks-ts (header comment "Source: https://usehooks-ts.com/…") | MIT, `Copyright (c) 2020 Julien CARON` — `LICENSE` at `juliencrn/usehooks-ts` HEAD `61949134144d3690fe9f521260a16c779a6d3797` | Sub-vendored inside the bazza copy. |
| `components/common/settings/integration-logos.tsx` | 510 | Brand SVGs "sourced from https://logos.lndev.me" (line 3) | **Not verified.** These are third-party trademarks (GitHub, Slack, GitLab, …); MIT grants no trademark rights | Do not take (section 6). |

Runtime dependency of note (not vendored): `@kayron013/lexorank` 2.0.0, **ISC** (`registry.npmjs.org` metadata, and `LICENSE` at `Kayron013/LexoRank` `4974c635eb9c4f0b9188e849cded3e609cd52d23`: `Copyright (c) 2022, Angel Campbell`). The other dependencies' licences were not individually checked here; Islestone's licence gate checks any it actually installs.

## 2. Parts worth studying, with exact paths and line counts

Verdict key: **Pattern** = read the design, write fresh (recommended default); **Skip** = nothing Islestone needs; no row is recommended as a verbatim copy (section 6 explains why).

### 2.1 Application shell (feeds 1.7, used by 2.3)

| Path | Lines | What it is | Verdict |
|---|---|---|---|
| `components/layout/main-layout.tsx` | 55 | Shell: `SidebarProvider` → create-item modal + command palette + sidebar + an inset, rounded, bordered content card; content height `100svh − n×40px` (n = 1 or 2 header rows; +16px inset on `lg`) | Pattern |
| `components/ui/sidebar.tsx` | 690 | shadcn sidebar: open state in a cookie (`sidebar_state`, 7 days), ⌘/Ctrl+B toggle, mobile `Sheet` under 1024px, `offcanvas`/`icon` collapse, widths 244px / 260px mobile / 3rem icon | Skip (inflect's `SidebarNav`/`sidebar-collapse-context` already cover it) |
| `components/layout/sidebar/app-sidebar.tsx` | 108 | Swaps the nav set when the path contains `/settings` (back-to-app header + settings nav) vs the app nav (inbox, workspace, teams). Footer is promotion | Pattern for the swap only; footer excluded |
| `components/layout/sidebar/nav-inbox.tsx` | 85 | Personal section (Inbox, Reviews, My issues, Agent) with badges honouring sidebar prefs | Pattern |
| `components/layout/sidebar/nav-workspace.tsx` | 123 | Workspace section; hidden items fall into a "More" dropdown that also opens "Customize sidebar" | Pattern |
| `components/layout/sidebar/nav-teams.tsx` | 195 | "Your teams": one collapsible per joined team with sub-links (Triage with count badge, Issues, Cycles, Projects, Views, …) and a per-team "…" menu | Pattern |
| `components/layout/sidebar/customize-sidebar-dialog.tsx` | 241 | Badge style (count/dot), per-item visibility (always / only when badged / never), native HTML5 drag reorder per section | Pattern |
| `store/sidebar-prefs-store.ts` | 112 | Persisted prefs + `resolveOrder` + `isSidebarItemVisible` (section 4.3) | Pattern |
| `components/layout/sidebar/org-switcher.tsx` | 97 | Workspace switcher dropdown | Skip (inflect has `org-workspace-switcher.tsx`, `tenant-switcher.tsx`) |
| `components/layout/sidebar/nav-settings.tsx`, `nav-teams-settings.tsx` | 123, 49 | Settings nav groups (Personal / Issues / Projects / Features, then per-team) | Pattern (1.7 settings IA) |
| `components/layout/headers/issues/{header,header-nav,header-options,notifications}.tsx` | 11, 143, 29, 97 | Two-row header: row 1 = sidebar trigger, tabs (All/Active/Backlog), search, notifications; row 2 = right-aligned Filter, Insights-panel toggle, Display popover | Pattern |
| `components/layout/headers/display-options.tsx` | 267 | Linear-style "Display" popover: list/board switch, grouping, ordering, completed visibility, show sub-items, show empty groups, display-property chips, reset when non-default | Pattern |
| `components/layout/headers/team/header-tabs.tsx` | 41 | Team page tabs | Pattern |
| `components/layout/headers/issue/header-nav.tsx` | 109 | Detail header with breadcrumb and previous/next item navigation | Pattern |
| `components/layout/command-palette.tsx` | 608 | ⌘K palette, aware of the item in the URL, with sub-pages (section 4.6) | Pattern |
| `store/right-panel-store.ts` | 28 | One right-side panel at a time: `insights` \| `cycle-details` \| `breakdown` \| `hidden` \| null | Pattern |
| `hooks/use-mobile.ts` | 19 | `matchMedia` breakpoint hook at 1024px | Skip (inflect has hooks) |

### 2.2 List and board (2.3 core)

| Path | Lines | What it is | Verdict |
|---|---|---|---|
| `components/common/issues/grouped-issues-view.tsx` | 314 | The grouping engine for list and board, "hidden by filters" footer, board "Hidden columns" section (section 4.1) | Pattern — the most useful file |
| `components/common/issues/group-issues.tsx` | 148 | `IssueGroupDescriptor` {id, name, color, icon, status?}; sticky tinted group header with count and "+" (create in this group's state); board column drop target | Pattern (descriptor); Skip (react-dnd code) |
| `components/common/issues/issue-line.tsx` | 82 | 44px list row: priority, key, state, title link, labels/project (collapsed overlap that spreads on hover), cycle chip, due, created, assignee — each gated by a display property | Pattern |
| `components/common/issues/issue-grid.tsx` | 158 | Board card + custom drag layer (empty native preview, fixed-position React preview) | Pattern for card layout; Skip DnD |
| `components/common/issues/issue-context-menu.tsx` | 354 | Right-click menu: state, assignee, priority, labels, project, due date, add link, copy, make a copy, create related, mark as (completed / duplicate / won't fix), move, subscribe, favourite, remind, delete. Many handlers only show a toast | Pattern (menu IA only) |
| `components/common/issues/status-selector.tsx`, `priority-selector.tsx`, `assignee-user.tsx` | 95, 101, 107 | Inline property pickers (popover + command list) | Skip (inflect `<Combobox>` covers it) |
| `components/common/issues/label-badge.tsx`, `project-badge.tsx` | 23, 17 | Chips | Skip |
| `components/common/issues/insights-panel.tsx` | 245 | 420px right panel: count per state segmented by priority (recharts), rows click-to-filter | Pattern (later, 3.6) |
| `components/common/issues/use-panel-filter.ts` | 77 | Exclusive click-to-filter from side panels into the main filter bar (section 4.4) | Pattern |
| `components/common/issues/issue-filter-{bar,columns,trigger}.tsx` | 43, 194, 30 | Filter chips row (only once a filter exists), column config, header trigger | Pattern |
| `components/common/issues/all-issues.tsx`, `cycle-issues.tsx` | 84, 87 | Page compositions: category-scoped tabs; cycle-scoped view with side panel | Pattern |
| `components/common/issues/search-issues.tsx` | 53 | Client-side title search results | Skip (2.7 is server FTS) |
| `store/display-settings-store.ts` | 102 | Display settings shape (section 3.2) | Pattern (becomes `SavedView` fields) |
| `store/view-store.ts` | 22 | `list` \| `grid` (persisted) | Pattern (→ `ViewLayout`) |
| `store/filter-store.ts` | 76 | Filters in the URL under one `?filters=` JSON parameter (section 4.5) | Pattern |
| `store/issues-store.ts` | 247 | The only mutable data store: CRUD + per-field updates + client filters | Skip (ADR 0005: server-authoritative, one query cache) |
| `components/data-table-filter/core/{types,operators,filters}.ts`, `lib/filter-fns.ts` | 352, 407, 468, 175 | Typed filter model, operator vocabulary, per-type match functions (section 4.5) | Pattern; bazza code, see attribution |
| `components/data-table-filter/components/*` | 1,833 | Chip UI: subject / operator / value / remove | Pattern only |

### 2.3 Detail view (2.3)

| Path | Lines | What it is | Verdict |
|---|---|---|---|
| `components/common/issues/details/issue-details.tsx` | 119 | Two-column detail: description + activity left, properties panel right | Pattern |
| `components/common/issues/details/content-blocks.tsx` | 255 | Renders a `ContentBlock[]` union (inline code/bold parsing) | Skip (Islestone uses Tiptap) |
| `components/common/issues/details/activity-feed.tsx` | 146 | Merged events + comments with a local composer | Pattern (ADR 0006 "Activity" read model) |
| `components/common/issues/details/issue-properties-panel.tsx` | 131 | State, priority, assignee, labels, project, milestone, blocked-by / related, PR links | Pattern |

### 2.4 Adjacent surfaces (other sub-phases)

| Path | Lines | Sub-phase | Verdict |
|---|---|---|---|
| `components/common/triage/{triage,triage-details}.tsx`, `store/triage-store.ts` | 104 + 256, 80 | 2.6 intake | Pattern (split view; section 4.8) |
| `components/common/inbox/*` (4 files) | 583 | 2.7 inbox: resizable two-pane (350/350, max 500), single pane with back on mobile; preview renders the live item | Pattern |
| `components/common/my-issues/*` (3 files) | 265 | 2.7 My Work: Assigned / Created / Subscribed / Activity tabs | Pattern |
| `components/common/views/{views,view-details}.tsx`, `mock-data/views.ts` | 219 + 72, 303 | 2.4 saved views | Pattern |
| `components/common/cycles/*` (5 files), `mock-data/cycles.ts` | 702, 238 | 2.5 cycles: timeline, burn-up legend, capacity ring, details panel | Pattern for layout; **the burn-up data is synthetic** (section 4.10) |
| `components/common/projects/projects-timeline.tsx` | 521 | 3.1 timeline (section 4.9) | Pattern for zoom/indicators only; SVAR is the roadmap pick |
| `components/common/initiatives/*` (4 files) | 1,334 | 3.2 initiatives | Pattern |
| `components/common/settings/shared.tsx` | 174 | Settings primitives: shell, section, card, row, select menu | Pattern (1.7) |
| `components/layout/theme-applier.tsx`, `store/theme-store.ts`, `components/common/settings/theme-preferences.tsx` | 167, 65, 344 | Themes incl. a custom theme from accent / background / contrast (section 4.11) | Skip for 1.2 (Islestone has `tokens.contract.css`); idea noted |
| `components/common/agent/agent-chat.tsx`, `store/agent-chat-store.ts` | 277, 107 | Canned-reply chat | Skip (6.4 uses assistant-ui or AI Elements) |
| `components/common/reviews/*` (7 files) | 1,004 | PR review split view | Skip for now (not on the roadmap; closest is 5.3) |

## 3. Data model (TypeScript interfaces; there are no tables)

### 3.1 Domain records

```
StatusCategory = triage | backlog | unstarted | started | completed | canceled
Status       { id, name, color, category: StatusCategory, icon }      -- 13 global statuses, not per team:
               in-progress(started) technical-review(started) done(completed) paused(started)
               to-do(unstarted) backlog(backlog) triage(triage) idea(backlog) product-feedback(started)
               blocked(started) shipped(completed) canceled(canceled) duplicate(canceled)
Priority     { id: urgent|high|medium|low|no-priority, name, icon }
Label        { id, name, color }                                      -- "LabelInterface"
User         { id, name, avatarUrl, email, status: online|offline|away,
               role: Member|Admin|Guest|Application, joinedDate, teamIds[], timezone(IANA) }
Team         { id ("CORE"), name, icon(emoji), joined:bool, color, members: User[], projects: Project[] }
Health       { id: no-update|off-track|on-track|at-risk, name, color, description }
Project      { id, name, status: Status, icon, percentComplete, startDate, targetDate?, lead: User,
               priority: Priority, health: Health, teamId → Team, labels: Label[],
               initiative?: string, healthUpdatedAgoDays? }
Issue        { id, identifier ("LNUI-703"), title, description, status: Status (embedded),
               assignee: User|null, priority, labels: Label[], createdAt, cycleId ('' = none) → Cycle,
               project?: Project (embedded), subissues?: id[], rank (LexoRank string), dueDate? }
Cycle        { id, number, name, teamId → Team, status: planned|upcoming|current|completed,
               startDate, endDate, capacity, scope, scopeDelta, started, completed, successRate?,
               burnup?: { date, scope, started, completed, ideal }[] }
IssueDetail  { identifier → Issue, description: ContentBlock[], activity: ActivityItem[],
               subIssueIds?, relatedIds?, blockedByIds?, prLinks?: { id, title, status: open|merged|draft }[],
               milestone?: string }
ContentBlock = heading{text,level?} | paragraph | bullet-list | numbered-list | checklist{items{text,checked}}
             | code{language,code} | image{alt,caption?,aspect?} | video{title,duration?} | quote{text,author?}
             | divider | issue-ref{identifier,note?}
ActivityItem = event{ id, actor: User, event, text, timeAgo }
             | comment{ id, actor: User, timeAgo, body: ContentBlock[], reactions?: {emoji,count}[] }
ProjectDetail { projectId → Project, summary, description: ContentBlock[], resources: {label,url}[],
                milestones: {id,name,targetDate?,completed}[], updates: {id,author,date,health,blocks}[],
                activity: {id,user,date,text}[] }
Initiative   { id, name, description?, icon(emoji), status: active|planned|completed|canceled, priority,
               owner?: User, leadTeamId? → Team, target?: free text ("Q3 2026"), health, projectIds[] → Project, createdAt }
View         { id, name, description, icon(emoji), type: issue|project, teamId? → Team (none = workspace),
               owner: User, createdAt, updatedAt,
               filter: { statusCategories?, statusIds?, labelIds?, priorityIds?, hasProject?, unassigned? } }
TriageItem   { id, identifier, title, teamId, reporter: {kind:user,user} | {kind:integration,name}, receivedAgo,
               intelligence: { suggestedAssignee?, suggestedProject?, suggestedLabels[], related[{identifier,title,status}] },
               sections: {heading,body}[], preview? }
InboxItem    extends Issue + { content, type: comment|mention|assignment|status|reopened|closed|edited|created|upload,
               user: User, timestamp, read }
TeamDocument { id, name, icon, creator: User, createdAt, updatedAt, pinned? };  DocumentFolder { id, name, icon, documents[] }
```

Relations are mostly **embedded objects, not foreign keys**: an issue holds a copy of its status, project and assignee; a team holds copies of its members and projects. Only `cycleId`, `teamId`, `leadTeamId`, `projectIds` and the detail records' id lists are references.

### 3.2 View-state records (the part 2.3 and 2.4 actually need)

```
DisplaySettings { grouping: status|assignee|priority|project|none, ordering: priority|created|title,
                  orderCompletedByRecency, completedIssues: all|none, showSubIssues, showEmptyGroups,
                  displayProperties: Record<id|status|priority|assignee|labels|project|dueDate|created|cycle, bool> }
                  defaults: grouping=status, ordering=priority, completed=all, emptyGroups=false,
                  properties on except dueDate and cycle
ViewType        list | grid
FiltersState    [{ columnId, type: text|number|date|option|multiOption, operator, values[] }]
RightPanel      insights | cycle-details | breakdown | hidden | null
SidebarPrefs    { badgeStyle: count|dot, visibility: Record<item, always|badged|never>,
                  order: { personal: [inbox, reviews, my-issues, agent],
                           workspace: [initiatives, projects, views, teams, members] } }
```

Persistence: display settings, view type, sidebar prefs and theme in `localStorage` (Zustand `persist`); filters and sort in the URL (nuqs).

### 3.3 Mapping onto Islestone (ADR 0002, 0003, 0006)

| circle | Islestone | Note |
|---|---|---|
| `Issue` | `WorkItem` | ADR 0006 bans "Issue" outside integration adapters and quotes. |
| `identifier` "LNUI-703" | `Project.keyPrefix` + `WorkItem.number` from `ProjectKeySequence` | circle has one global prefix. |
| `Status` (13, global) | `WorkflowState` rows per team, UI label "Status" | ADR 0002 §3. |
| category `backlog / unstarted / started` | `BACKLOG / UNSTARTED / STARTED` | |
| category `completed` | `DONE` | |
| category `canceled` | `CANCELLED` | ADR 0006 rule 7 spelling. |
| category `triage` | **no category**: intake is a stage, `IntakeRequest` | ADR 0006 "Intake". A triage *state* must not be ported. |
| `Priority` `no-priority` | `WorkItemPriority` none | |
| `rank` (LexoRank) | `sortKey`, server-computed, `"C"` collation | ADR 0002 §5. |
| `subissues` | `WorkItem.parentId` | |
| `relatedIds` / `blockedByIds` | `WorkItemRelation` `RELATES` / `BLOCKS` | |
| `prLinks` | `WorkItemLink` | |
| `milestone` (string) | `Milestone` with `WorkItem.milestoneId` | |
| `ActivityItem` | Activity read model (comments + audit + agent activity) | |
| `View` + `DisplaySettings` | `SavedView` (filters, grouping, sorting, layout, visible columns; personal or shared) | circle splits the two; Islestone stores them together. |
| `ViewType` `grid` | `ViewLayout` `BOARD` | |
| `Initiative.projectIds[]` and `Project.initiative` | `Project.initiativeId`, single-parent | ADR 0002 §2. |
| `Initiative.target` free text | a date | |
| `TriageItem` | `IntakeRequest` | |
| `User.role = Application` | `Agent`, never a user or member | ADR 0003 §3. |
| "Agent" chat page | Assistant | ADR 0006: the assistant is not an agent. |
| `TeamDocument` | `Page` | |
| `Cycle` | `Cycle`. circle stores counters on the cycle row; Islestone must derive them | Roadmap principle 4. |

## 4. Algorithms (prose and pseudo-code, not copied code)

### 4.1 Grouping engine (`grouped-issues-view.tsx`)

Two inputs: the **visible** items (after the filter bar) and the **scope** items (same scope, before the filter bar). Groups are built from the scope so a group emptied by a filter still exists and shows `0 / total`.

```
hideDone(list) = completedVisibility == none ? list without DONE/CANCELLED : list
V = hideDone(visible); S = hideDone(scope)
groups = case grouping of
  state:    for each state in display order -> {state, items: V where state, total: |S where state|}
  priority: for each priority in fixed order -> same
  assignee: buckets of S by assigneeId ('none' bucket), ordered by bucket size desc; items from V
  project:  same as assignee, keyed by projectId
  none:     one group 'all'
for each group: sort items by ordering (priority asc | created desc | title)
board: if any filter is active
         columns = groups with items; collapsed "Hidden columns" = groups with none (shows 0 / total)
       else columns = groups where showEmptyGroups or items non-empty
list:  rows = groups where showEmptyGroups or items non-empty
footer "n items hidden by filters" when a filter is active and n = |scope| − |visible| > 0 (with Clear)
```

Gaps Islestone must close: the counts assume the whole scope is in memory, which a cursor-paginated list does not have, so per-group totals need a server count by group key. There is no "manual" ordering by `sortKey`; `orderCompletedByRecency` and `showSubIssues` are stored but never read by this view.

### 4.2 Two state orders (`mock-data/status.tsx` lines 186-224, constants at 191 and 201)

- Workflow order, for analytics: triage, backlog, unstarted, started, completed, canceled.
- Display order, for grouped views: started, unstarted, triage, backlog, completed, canceled (work in progress first).
- Ties inside a category keep declaration order. In Islestone the tie-breaker is the team's `WorkflowState` position.

### 4.3 Sidebar customisation (`sidebar-prefs-store.ts`)

```
resolveOrder(stored, defaults):
  result = stored filtered to keys still in defaults        # drop removed items
  for each key k at index i in defaults not in result:      # items added after the prefs were saved
     insert k right after the nearest earlier default already in result (else at 0)
isVisible(pref, badgeCount) = pref missing or 'always' -> true; 'badged' -> badgeCount > 0; 'never' -> false
Hidden items are listed in the section's "More" menu, so nothing becomes unreachable.
```

A small, well-shaped rule for 1.7. Islestone decides where it lives: per-member server preference, or `localStorage` as a per-viewer convenience.

### 4.4 Exclusive side-panel filter (`use-panel-filter.ts`)

```
toggle(target):
  next = filters minus the single-value filter this panel added last time (if still present)
  if target != last: next += { columnId, operator: labels ? include : is, values: [value] }
  last = (target == last) ? none : target
active(target) = last == target and that filter is still in the bar
```

Panel filters land in the ordinary filter bar, so they stay visible and shareable, and two panel clicks never stack.

### 4.5 Filter model and URL state (`data-table-filter/`, `filter-store.ts`)

- A filter is `{columnId, type, operator, values[]}`; a view's filter is an AND of these.
- Operators per type:
  - `option`: is, is not, is any of, is none of;
  - `multiOption`: include, exclude, include any of, include all of, exclude if all, exclude if any of;
  - `date`: is, is not, is before, is after, is on or after, is on or before, is between, is not between;
  - `text`: contains, does not contain;
  - `number`: is, is not, >, ≥, <, ≤, is between, is not between.
- Singular and plural operators are paired: is ↔ is any of, is not ↔ is none of. Every operator also names its negation. When the number of selected values crosses from one to many (or back), the operator switches to its pair (`determineNewOperator`).
- Faceted option counts come from the data (`facetedOptions`).
- URL: one `?filters=` parameter holding JSON. Parse failures read as no filters; elements that fail a shape check are dropped; an empty list removes the parameter.

What not to inherit:
- `filter-fns.ts` tests `operator in ['is between', 'is not between']`. `in` on an array tests indices, so the "two values" check never runs.
- An item with no value (for example unassigned) fails every option operator, negative ones included, so "assignee is not X" hides unassigned items.
- The URL shape check is not a schema. Islestone uses a Zod filter AST with a size bound, and compiles it to a server-side Prisma `where`, because 2.4 needs the same filters in the API.

### 4.6 Context-aware command palette (`command-palette.tsx`)

```
context item = the item whose key is in the path /:org/issue/:key (dismissable with ⌫ on an empty query)
root page = context ? [Item actions (assign, state, priority, project, labels, cycle, team, due date),
                       Copy (key, URL, title, "[KEY: title](url)" link, description, branch name, …)]
                    : [Actions (create item), Go to (inbox, my work, projects, views, teams, members, settings)]
sub-page  = one of assign|status|priority|labels|project|cycle|team|due-date; Esc or ⌫ on an empty query -> root
Tab on root -> hand off to the agent page
branch name = userId + "/" + lower(key) + "-" + slug(title) truncated to 40 characters
```

The key chips shown beside commands (A, S, P, G then I, …) are labels only: no handler is registered for them. Islestone binds real shortcuts with inflect's `useKeyboardShortcut`, and Tab hands off to the Assistant, not an agent.

### 4.7 Board drag and drop (`group-issues.tsx`, `issue-grid.tsx`)

react-dnd with the HTML5 backend. Columns and cards are both drop targets. The column's drop handler changes the state only when `monitor.didDrop()` is true, that is, only when the item was dropped on a card. A drop on empty column space does nothing. A drop never updates `rank`, so a board cannot be reordered, and nothing works from the keyboard. The custom drag layer hides the native preview and draws a fixed-position card under the pointer. **Take nothing.** Roadmap 2.3 uses pragmatic-drag-and-drop, a server-computed `sortKey`, and keyboard reordering, and gate H2 requires keyboard and screen-reader support.

### 4.8 Intake split view (`triage-store.ts`)

The queue is on the left and the selected request on the right. Accept turns the request into an item in the default unstarted state, prefilled with the suggested assignee, project and labels. Decline and Snooze only remove it. After any action, selection moves to the next request of the same team. Islestone's 2.6 also needs merge-into-duplicate, a real snooze with a wake time, and server writes. The "Triage Intelligence" card (suggested assignee, project, labels and related items) is a good target shape for 7.2's triage proposal.

### 4.9 Timeline geometry (`projects-timeline.tsx`; for 3.1)

- The range is fixed, 2020-01-01 to 2032-12-31.
- Months are cells of equal width. Zoom sets the month width: Year 120, Quarter 240, Month 480, Week 960 pixels. The keys Y, Q, M and W switch zoom, and are ignored while typing.
- A date maps to x = (t − start) / (end − start) × total width. That is linear in time while the cells are equal per month, so bars drift against the grid (a 28-day February is as wide as a 31-day month).
- Bars are at least 130 pixels wide.
- Week ticks fall on Mondays; an ISO week number is computed for them.
- An off-screen bar shows an arrow that scrolls to it.
- "Today" lands at max(viewport width / 3, list width + 80).

Worth keeping: the zoom levels, their keys, the out-of-view indicators and the today anchor. Everything else is SVAR's job.

### 4.10 Burn-up and cycle counters (`mock-data/cycles.ts` lines 36-80)

Synthetic. Completion follows an eased curve, 3t² − 2t³; scope grows linearly to its end value; "ideal" is a straight line. It is deterministic only so that the server and client renders agree. Under roadmap principle 4 Islestone computes burn-up from each item's state history and its cycle membership per day. **Do not take the curve.**

### 4.11 Custom theme derivation (`theme-applier.tsx` lines 9-100)

- Input: background, accent and contrast (0-100).
- Dark or light background is decided by Rec.601 luma below 0.5. The foreground is near-white or near-black to match.
- Border = mix(background, foreground, 0.08 + 0.14k), where k = contrast / 100.
- Subtle surface = mix(background, foreground, 0.05 + 0.09k).
- Container and card = background mixed 3% toward white (on dark) or black (on light).
- The values are written as CSS custom properties on `:root`.

Two problems. The raw `background` string is written as-is, without validation. Rec.601 luma is not a WCAG contrast check. If Islestone ever offers custom themes, it must validate `^#[0-9a-f]{6}$` with Zod and check the WCAG contrast ratio.

## 5. Mapping onto Islestone's roadmap and ADRs

| Islestone item | What circle offers | Constraint that governs it |
|---|---|---|
| **2.3 list** | Group descriptor and engine (4.1); 44px row with display-property gating; sticky tinted group headers with a count and a create-in-group "+"; "hidden by filters" footer; two-row header (tabs and search, then Filter, panel toggle and Display) | Build on inflect's `EntityListPage` and filter system (Epic 52/53). Group counts come from the server, because the list is cursor-paginated |
| **2.3 board** | Columns per group; "Hidden columns" under filters; card layout; create-in-column | pragmatic-dnd; server `sortKey` (ADR 0002 §5); keyboard reordering; virtualised columns (2.3 prompt). circle has none of these |
| **2.3 detail** | Two-column layout (body and activity, then a properties rail); previous/next in the header; the properties rail's field order | Sheet and full page from one query (2.3 prompt); Tiptap, not `ContentBlock` |
| **2.3 destructive actions** | Context-menu layout | The undo toast (Epic 67 pattern) replaces circle's immediate delete |
| **2.3 optimistic mutations** | All in-memory | ADR 0005 §3: TanStack Query, roll back on failure, 409 handling, a per-item write queue |
| **1.7 shell** | Inset content card; settings-mode sidebar swap; personal / workspace / "your teams" sections; customise-sidebar rules (4.3); context-aware palette (4.6); a single right-panel slot | Write the navigation config fresh (1.7 prompt); inflect's `AppShell` and `SidebarNav` are the base |
| **2.4 saved views** | Display settings shape; `View` with a team scope; the filter operator vocabulary and singular/plural switching (4.5) | `SavedView` holds filters, grouping, sorting, layout and columns together (ADR 0006); a Zod AST compiled server-side |
| **2.5 cycles** | Cycle list and details panel layout; capacity ring | Burn-up derived from history (4.10); `CANCELLED` spelling |
| **2.6 intake** | Split view; accept prefill; the suggestions card (4.8) | `IntakeRequest`, never a "triage" state (ADR 0006); add merge and snooze with a wake time |
| **2.7 inbox, My Work** | Resizable two-pane inbox with a live preview; My Work tabs | Inbox ≠ Intake (ADR 0006) |
| **3.1 timeline** | Zoom levels and keys, out-of-view indicators (4.9) | SVAR React Gantt (roadmap 2.3) |
| **3.2 initiatives** | List and detail layouts; health breakdowns | Single-parent `Project.initiativeId` (ADR 0002 §2) |
| **3.6 analytics** | Insights panel (count per state by priority), click-to-filter (4.4) | Numbers from code (principle 4) |
| **6.3 delegates** | `role: Application` users | Contradicts ADR 0003: an `Agent` is not a `User` |
| **ADR 0001 / 0.3** | MIT plus three embedded MIT upstreams | `PROVENANCE.md` rows; `NOTICE` entries only if code is copied |

## 6. What Islestone must NOT take

**No copyleft or source-available code was found.** Everything below is excluded for other reasons:

1. **Promotion and branding.**
   - The `app-sidebar.tsx` footer (lines 41-105): Square UI Pro, square.lndev.me, the Vercel OSS badge and the GitHub link.
   - `help-button.tsx`, which links to the author's social and shop pages.
   - The `app/layout.tsx` metadata: site URL, author and OG data.
   - `public/*` (icon and banner), `app/favicon.ico`, the `lndev-ui` org slug and the `LNUI-` keys.
2. **The paid "BaseUI" variant** on Square UI Pro. It is commercial and not in this repository.
3. **`integration-logos.tsx`.** These are third-party trademarks, their source licence was not verified, and MIT grants no trademark rights.
4. **Linear trade dress.**
   - The hand-drawn status and priority SVGs in `mock-data/status.tsx` and `priorities.tsx`, which imitate Linear's icons.
   - The theme names "Magic Blue" and "Classic Dark".
   - Pixel-for-pixel layouts.

   Islestone takes interaction patterns and draws its own icons and names.
5. **`mock-data/`** (10,609 lines). It is fake content, including DiceBear avatar URLs whose style licences were not checked.
6. **`components/ui/`** (shadcn) and the Radix/shadcn dependency set. A second primitive system would break roadmap 1.2's `@inflect/ui` model.
7. **react-dnd board code** (4.7). The roadmap picks pragmatic-drag-and-drop.
8. **State architecture.** Zustand stores as the source of data, and `localStorage` for display settings that belong in a `SavedView`. Both conflict with ADR 0005 §2-3.
9. **Ordering by `rank.localeCompare`** (`issues-store.ts`, initial sort). ADR 0002 §5 requires byte comparison and a server-computed key. Use the in-house fractional index (option F1), not `@kayron013/lexorank`.
10. **The vocabulary**: Issue, the triage category, `CANCELED`, the "Agent" chat page, "grid". See ADR 0006 and section 3.3.
11. **Agents as users** (`role: 'Application'`). ADR 0003 §3 forbids it.
12. **The synthetic burn-up curve and the stored cycle counters** (4.10).
13. **The bugs in `data-table-filter`** (4.5). If any bazza code is taken, it needs its own attribution (section 7). The recommendation is to take none.
14. **Unvalidated theme input** (4.11).

## 7. Attribution text Islestone would have to carry

**Recommended path: pattern only, no code copied.** Every row in section 2 is marked Pattern or Skip, and Islestone writes its own code in its own vocabulary. On that path the MIT licence asks for nothing in `NOTICE`. Roadmap principle 6 and the intake policy still need the following row in `PROVENANCE.md`, moved from "UNPINNED" to Adopted:

| Component | Source | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| ln-dev7/circle: Linear-style UI shell (1.7, 2.3; layout ideas for 2.4-2.7, 3.1, 3.2) | `github.com/ln-dev7/circle`: `components/layout/{main-layout.tsx,sidebar/*,headers/*,command-palette.tsx}`, `components/common/issues/*`, `store/{display-settings,sidebar-prefs,filter,right-panel}-store.ts` | `b0ba7ddcc3d0f4c16092236ca6a01b56c0614810` | MIT (`LICENSE.md`, "Copyright (c) 2025 lndev-ui \| Circle Template") | Pattern only, no code copied: grouping and hidden-by-filter rules, the display-options model, sidebar order/visibility resolution, exclusive panel filter, context-aware palette sub-pages | Islestone vocabulary (ADR 0006); server-computed groups, counts and `sortKey`; pragmatic-dnd; `SavedView` persistence; Zod filter AST |

A separate row is needed for bazza/ui (`github.com/kianbazza/ui`), even when only the operator vocabulary is learned from circle's copy. Its upstream LICENSE was read at `fe486a6a2ee1779482c0696b5a7008de6039983b` (MIT, Kian Bazarjani). Note that the commit circle vendored from is unknown.

**If any code is copied or adapted from circle,** add this to `NOTICE` under "Third-party notices", followed by the full MIT permission and warranty text from circle's `LICENSE.md`:

```
ln-dev7/circle — github.com/ln-dev7/circle, commit b0ba7ddcc3d0f4c16092236ca6a01b56c0614810
Files: <list the Islestone files that contain copied or adapted code>
Copyright (c) 2025 lndev-ui | Circle Template
Licensed under the MIT License:
<full MIT permission and warranty text, as in the source LICENSE.md>
```

**Additional NOTICE entries, only if their code is copied:**
- **From `components/data-table-filter/`:** "bazza/ui (github.com/kianbazza/ui) — Copyright © 2025 Kian Bazarjani — MIT". Pin the upstream commit actually used, because circle does not record it.
- **From `components/ui/`:** "shadcn/ui (github.com/shadcn-ui/ui) — Copyright (c) 2023 shadcn — MIT".
- **From the two hooks in `data-table-filter/hooks/`:** "usehooks-ts (github.com/juliencrn/usehooks-ts) — Copyright (c) 2020 Julien CARON — MIT".

Each entry carries the full MIT text, as above.

## 8. Not verified

- The bazza/ui commit circle's `components/data-table-filter/` was copied from. The upstream licence was read only at today's HEAD.
- The licence of the logos.lndev.me SVGs and of the DiceBear avatar styles. Neither is to be taken anyway.
- The licences of circle's npm dependencies other than `@kayron013/lexorank`.
- Whether every outside contributor's commits are MIT. There is no CLA or DCO, so this assumes the usual inbound = outbound convention. All four non-maintainer identities together account for 12 of 185 commits.
- How the UI renders. No code was run, so this study covers code structure, not how the pages look.

## Licence check

**CONFIRMED.** I checked the licence facts in section 1 on 2026-11-18, without relying on the first study. I only read files. Nothing was run or installed. Section 1 needed no change.

| Claim in section 1 | How it was checked | Result |
|---|---|---|
| Pin `b0ba7ddcc3d0f4c16092236ca6a01b56c0614810`, still upstream HEAD | `git rev-parse HEAD` in the clone. `git ls-remote --symref https://github.com/ln-dev7/circle HEAD` returned `ref: refs/heads/master` at `b0ba7dd…` | Confirmed. The default branch is `master`, not `main` |
| MIT licence in `LICENSE.md`, 21 lines, "Copyright (c) 2025 lndev-ui \| Circle Template" | Read the clone's `LICENSE.md`. Fetched `https://raw.githubusercontent.com/ln-dev7/circle/b0ba7ddcc3d0f4c16092236ca6a01b56c0614810/LICENSE.md` (HTTP 200) | Confirmed. The fetched copy is byte-identical to the clone's: git blob `4fb4abda2c2500d50cda81a66f998494876468d9`, sha256 `32353f5418b090ca41d9ccd6ebd9eed92b059febcd94c914c379444c9c47c1fe`. After the title and copyright lines, the text matches the standard MIT (SPDX `MIT`) permission and warranty text word for word. `…/<commit>/LICENSE` with no extension returns HTTP 404, as expected, because the file is `LICENSE.md` |
| One commit to `LICENSE.md`, `f3418bc` (2025-03-05) | `git log -- LICENSE.md LICENSE license*` | Confirmed |
| No other licence, NOTICE, CLA or DCO files | `git ls-files \| grep -iE 'licen\|copying\|notice\|patent\|cla\|dco'` returned only `LICENSE.md` | Confirmed |
| No copyleft or source-available markers | `git grep` for GPL, LGPL, AGPL, MPL, Commons Clause, BUSL, SSPL, Elastic, "all rights reserved", proprietary, SPDX and `@license`. The lockfile was searched separately | Confirmed. As a whole word, case-insensitive, `MPL` matches only `public/banner.png`, which is binary noise. As a substring it also hits "simple", "IMPLIED" and similar words, which are false positives. The only text that mentions licences is fake support-ticket text in `mock-data/triage.ts` about a "Pro license". `pnpm-lock.yaml` has no hits |
| 185 commits, 6 author identities, 12 commits not by the maintainer | `git rev-list --count HEAD`, `git log --format='%an <%ae>'` | Confirmed: 164 + 9 by the maintainer's two identities. The other 12 are 7, 3, 1 and the Vercel bot's 1 |
| 356 tracked files | `git ls-files \| wc -l` | Confirmed |
| Vendored upstream licences | Fetched each upstream file at the commit section 1 names: `kianbazza/ui@fe486a6…/LICENSE.md`, `shadcn-ui/ui@968d8cb…/LICENSE.md`, `juliencrn/usehooks-ts@6194913…/LICENSE` and `Kayron013/LexoRank@4974c63…/LICENSE`. All returned HTTP 200 | Confirmed: MIT "Copyright © 2025 Kian Bazarjani", MIT "Copyright (c) 2023 shadcn", MIT "Copyright (c) 2020 Julien CARON", ISC "Copyright (c) 2022, Angel Campbell". The vendoring markers are where section 1 says: the `eslint.config.mjs` comment "Vendored bazza/ui data-table-filter", the "Source: https://usehooks-ts.com/…" header in `use-unmount.tsx`, and the "sourced from https://logos.lndev.me" header in `integration-logos.tsx` |

**One fact to add.** circle's `package.json` has no `license` field and sets `"private": true`. `LICENSE.md` is therefore the only licence declaration in the repository. A package-metadata scanner would report circle as unlicensed. This changes nothing, because circle is never installed as a dependency.

**Still not verified,** as section 8 says:
- which bazza/ui commit circle copied from;
- the licences of the logos.lndev.me SVGs and the DiceBear avatar styles;
- the licences of circle's other npm dependencies;
- the inbound licence of outside contributors' commits.
