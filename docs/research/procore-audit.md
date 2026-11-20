# Procore audit: ideas Islestone could take

> **Status: research note, written 2026-11-20, kept as written.** procore.com and its support and developer hosts (support.procore.com, v2.support.procore.com, developers.procore.com) were not reachable from the session that wrote it, so every Procore fact below comes from web-search summaries of those pages, Procore press releases, training pages and review sites. It holds ideas only: nothing was copied from Procore, and Islestone does not use Procore's product names or branding (they appear below only to say what is being described). On 2026-11-20 the owner adopted nine of the "Top 10" into the roadmap, all but #8, which 6.3 and a search skill already plan: decisions 76 to 84 in [`docs/HANDOFF.md`](../HANDOFF.md), placed in [`docs/ROADMAP.md`](../ROADMAP.md) (section 2.6 lists where). `PROVENANCE.md` records the source as ideas only.

**How this was researched.** procore.com, support.procore.com, v2.support.procore.com and developers.procore.com all failed to resolve from this session (a DNS error, meaning the hosts are outside the session's allowed network). So no Procore page was read directly. Every Procore fact below comes from web-search summaries of those pages, plus Procore press releases, training pages and review sites. Where a source was only a vendor blog or a competitor, or where sources disagreed, I say so. To check details first-hand, allow those four hosts in the session's network settings and re-run. Nothing was copied; this is ideas only. Islestone's side was read from `docs/ROADMAP.md`, `CLAUDE.md` ("Current state"), `docs/adr/README.md`, ADRs 0002, 0003, 0005 and 0006, and `docs/work-items.md`. I edited nothing.

---

## Procore at a glance

- **What it is.** A construction-management platform organised as a company → project hierarchy. Each project turns on "tools" (RFIs, Submittals, Daily Log, Punch List and so on), and each tool has its own records, statuses and per-tool permissions.
- **How it is sold.** An annual fee per product, priced by Annual Construction Volume, with unlimited users. Prices are not published (TrustRadius, third-party pricing blogs).

| Area | Capability (short) | Source quality |
|---|---|---|
| **RFIs** | Formal question log. An RFI Manager owns it; assignees and a distribution list respond. "Ball in Court" (BIC) marks whose move it is, and moves to the manager after a response. Several replies are possible; one is marked the **official response** before closing. Responding and marking need specific granular permissions. | Procore support (via search). A third-party guide disagrees on where BIC goes after a response. |
| **Submittals** | A review chain of sequential groups of approvers. BIC moves when every required member of a group has responded (parallel approval inside a step). An admin can reset BIC to an earlier step. Procore advises a *new revision* rather than reverting the chain, because reports only show current data. There is a "Reject Workflow" setting. | Procore support and release notes. |
| **Punch list** | Roles: Punch Item Manager and Final Approver. Assignees mark Work Required → Ready for Review → Resolved. The manager can mark Work Not Accepted; the item becomes Ready to Close; the final approver closes it or marks it Not Accepted. Overdue rules by status; an activity feed. | Procore support FAQ. Search also surfaced US patents 11,188,858 and 12,443,904 on punch-item coordination. The summary called the second Procore's; I did not verify the assignee. |
| **Inspections** | Company-level checklist templates with pass/fail lines. Per-line "requirements" can force an **observation on a failed line**, and the observation keeps an "Origin" link back to the inspection. Bulk edit of templates. | Procore FAQ and tutorial. |
| **Observations** | Typed (quality, safety, commissioning, warranty) for reporting. Assignee, priority, a distribution list emailed on status change and comments. Statuses: Initiated → Ready for Review → Not Accepted / Closed. Can be created from inspections, incidents and drawing pins. | Procore support and company process pages. |
| **Action Plans** | A multi-section plan of items, each with a **verification method** (photo, signature). A required signature can block later items in the section or in the whole plan (hold points). Reviewed before it is performed and again after. A final PDF goes to "completed plan receivers". | Procore tutorials. |
| **Daily Log** | More than 20 configurable sections: weather (auto-filled), manpower, deliveries, visitors, equipment, notes, photos, inspections, timecards. Subcontractors add their own entries. An AI Daily Log Agent drafts the log for a person to finalise. | Procore support; Groundbreak 2025 press release. |
| **Meetings** | Agenda mode → minutes mode. Items carry assignee, due date and priority. Unresolved items are **carried into the next meeting** automatically. Follow-up meetings; minutes emailed to attendees. | Procore marketing and third-party guides. Permission details conflict between sources. |
| **Correspondence** | Admin-defined **custom record types** (from scratch or templates such as Notice of Delay or Change Request), each with its own fieldset. Every field can be required, optional or hidden. Custom statuses map to closed-successful or closed-unsuccessful and can feed workflow steps. | Procore support and training. |
| **Workflows (company level)** | A builder for approval paths: standard, conditional, finish and termination steps, days allowed per step, branching on values (for example a contract amount). Applied to contracts, change orders and commitments. | Procore beta docs. Was a limited beta; current GA status unconfirmed. |
| **Drawings** | Sheet sets with revisions and side-by-side or overlay compare, including bulk compare to PDF. Markups and **pins that link RFIs, observations, punch items, photos and submittals to a spot on a sheet**. A linked drawing only shows on the RFI once the markup is published. | Procore help pages and marketing; third-party guides. |
| **Documents and photos** | Folder tree with automatic version control ("always the latest") and folder/file-level permissions. Photos are filed into albums with a location chosen at upload; AI auto-tags; album permissions. | Mostly third-party. GPS tagging not confirmed. |
| **Schedule** | Import or sync from MS Project, P6 and Phoenix. **Lookaheads** of 1–6 weeks layered over the master schedule; editing a lookahead does not change the master. Mobile schedule updates offline (beta, June 2026). | Procore docs. A competitor claims there is no CPM forward/backward pass; unverified. |
| **Financials** | Budget, prime contracts, commitments (subcontracts and purchase orders), change events → potential change orders → change orders, pending costs shown in the budget, direct costs, progress billing, Procore Pay (subcontractor payments, lien waivers). | Procore training and support; a third-party manual. |
| **Preconstruction** | Bid management: invitations, bid levelling, partner selection. | Vendor and competitor blogs only. Native prequalification not confirmed. |
| **Coordination issues (BIM)** | Log, assign and track model clashes; an issue can be **escalated into an RFI**. Procore AI drafts, summarises or queries an issue, and the user confirms before it is saved (July 2026). | Procore product page and "what's new". |
| **Workforce** | Timesheets with crews and cost codes, plus field-entry/PM-approval permissions; T&M tickets; resource planning. | Vendor pages and a case study. |
| **Directory and permissions** | Company and project directories; adding someone to a project adds them to the company directory. **Distribution groups** for mass notices. External collaborators. Permission templates at company and project level (global or project-specific). Per-tool level None / Read Only / Standard / Admin, plus granular permissions. **"Assignable" templates** that lower-level admins may grant. | Procore support; third-party explainers. |
| **Analytics** | Analytics 2.0: Power BI reports, embedded or in the customer's own Power BI (needs a licence). Custom reports combining data sources. | Procore support. |
| **AI** | Procore Helix (the intelligence layer). Assist (formerly Copilot): Q&A over RFIs, submittals, drawings, specs and documents, with citations. New activations paused during the Datagrid rebuild. Agent Builder in open beta (Oct 2025). Pre-built RFI Creation and Daily Log agents. Datagrid acquired January 2026. "Procore AI" (May 2026): agents for Deep Search, Submittals, RFI, Daily Log and Contract Review; **Actions** (live steps in Procore and connected systems) and **Triggers** (respond to events such as a new RFI); "agents require human consent before actions are finalized". Sold as "Digital Coworker" packages with a shared monthly credit pool; Agent Studio at the enterprise tier. | Procore press releases, Procore support, Datagrid release notes. The "150+ built-in actions" figure was relayed by one secondary source and not confirmed. |
| **Developer platform** | Versioned REST API, OAuth 2.0 (service accounts via client credentials), webhooks, sandbox, App Marketplace with review. An official Procore MCP server is **not confirmed**; community and hosted MCP wrappers exist. | Procore developer docs (via search); third parties. Marketplace size not found; the only figure (about 60) is old. |
| **Mobile** | iOS and Android. Offline work with later sync; "priority sync" of chosen data such as timesheets. | App Store listing, Procore support. Offline coverage per tool unconfirmed. |

---

## Coverage map (Procore area → Islestone status)

Key: **Has** = in the tree today (per `CLAUDE.md` "Current state"). **Plans** = a roadmap sub-phase covers it. **Lacks** = nothing in the roadmap.

| Procore area | Islestone | Notes |
|---|---|---|
| Company → project hierarchy | **Has** | Organization → workspace (`Tenant`) → team → project. The org shell waits for 8.3. |
| Directory of people | **Has** in part | Members, invites, roster route. |
| Directory of external companies | **Lacks** | Guests are 8.4; there is no "company" affiliation of external people. |
| Distribution groups | **Lacks** | Item watchers exist (2.2); there are no named groups. |
| Per-tool permission levels and templates | **Has** in part; **Plans** project-level roles (8.4) | `PermissionSet` with 12 domains, 5 roles and custom roles exists today. Project-scoped roles and project templates for guests do not. |
| "Assignable" templates | **Has** the concept | `ASSIGNABLE_TENANT_ROLES` limits which roles writers may grant. |
| Generic tracked record (RFI, observation, punch as separate tools) | **Has** one work-item table with configurable types (2.1–2.3) | Procore splits these into tools; Islestone deliberately does not (principle 3). |
| Custom record types with per-type fieldsets (required/optional/hidden) | **Plans** custom fields per *project* (2.4); per-*type* field layout **Lacks** | ADR 0002 §1: "Types carry no behaviour". |
| Ball in court ("whose move") | **Lacks** | Only the assignee (accountable person) and a delegate (agent). |
| Official answer on a question | **Lacks** | Comments exist, but none can be marked as the answer. |
| Review chain (sequential/parallel reviewers, revisions) | **Lacks** | ADR 0002 §3: "No reviewer gate in this ADR". The proposal queue (6.2) reviews *agent* changes only. |
| Configurable approval-path builder | **Plans** in part (5.1 trigger → condition → action) | No reviewer steps or step deadlines. |
| Punch-list style item lifecycle | **Has** via workflow states per team | States are per team, not per type. |
| Inspection checklists, fail → follow-up item | **Lacks** | Templates (2.5) are project and item templates, not checklist runs. |
| Observations | **Has** (an item type plus labels) | Distribution on status change is missing. |
| Action plans with hold points and sign-off | **Lacks** | |
| Daily log / periodic structured report | **Plans** in part (7.4 status digests) | No filed, person-finalised periodic report record. |
| Meetings: agenda, minutes, carry-forward | **Plans** in part (7.6: transcript → decisions and actions as proposals) | No meeting record, agenda or carry-forward. |
| Correspondence / formal letters | **Lacks** | Pages arrive in 4.1. |
| Drawings: sheets, revisions, compare | **Lacks** (sheet management) | |
| Pins linking items to a spot on a file or canvas | **Plans** in part (4.2: items dropped on the canvas stay linked) | Pins on files are not planned (4.4 gives previews only). |
| Documents with versions and folder permissions | **Plans** (4.1 page versions; 4.4 files) | No folder tree of files and no per-folder permissions. |
| Photos with album and location | **Plans** in part (4.4 attachments, image previews) | No albums or location. |
| Schedule, Gantt, critical path | **Plans** (3.1, in-house CPM) | Islestone's plan computes float and critical path; per a competitor, Procore's tool does not (unverified). |
| Lookahead | **Lacks** as a named view | Easy as a saved timeline view (2.4 + 3.1). |
| MS Project / P6 import | **Lacks** | 5.5 importers cover Jira, Linear, Asana, Trello and CSV only. |
| Calendar | **Plans** (3.3) | |
| Timesheets with approval | **Plans** (3.4: weekly approval, billable-rate cascade) | |
| Crews, resource planning | **Plans** in part (3.5 capacity and workload) | |
| Change event → change order cost flow | **Lacks** | Only billable rates in 3.4. |
| Budget, commitments, invoicing, payments | **Lacks** | Out of scope (see "Not a fit"). |
| Bid management, prequalification | **Lacks** | Out of scope. |
| BIM coordination | **Lacks** | Out of scope. |
| Analytics and dashboards | **Plans** (3.6, with Monte Carlo forecasts) | |
| BI export | **Lacks** | |
| AI Q&A with citations | **Plans** (6.4 assistant, 6.5 knowledge index, Phase 7 "cites the item ids") | |
| Pre-built agents (RFI, daily log, submittals) | **Plans** the platform (6.1–6.3); the specific skills **Lack** | 7.1–7.6 cover plans, triage, filters, digests, forecasts and meetings. |
| Agent triggers on events | **Plans** (6.3: invocation by mention, schedule or automation) | |
| Human consent before agent writes | **Has** the design (ADR 0003, proposals) and **Plans** it (6.2) | Islestone's ladder is stricter and per item. |
| No-code agent builder | **Lacks** as a builder; skills and evaluation gate in 6.6 | |
| AI credit-pool pricing | **Open** owner decision 7 (roadmap §7) | |
| REST API, OAuth, webhooks | **Plans** (5.2; API keys and webhooks with replay) | OAuth apps are not named. |
| App marketplace | **Plans** later (9.3 "plugin or app platform") | |
| MCP server | **Plans** (6.2; MCP Apps in 7.7) | Ahead of Procore's confirmed state. |
| Mobile | **Plans** (8.5 PWA) | Native apps in 9.3. |
| Offline | **Plans**, deferred (9.3; ADR 0005 E0) | |
| Email / Slack | **Has** SMTP outbox and notifications; **Plans** 5.4 | |
| Audit trail | **Has** (hash-chained, a stronger posture than anything found for Procore) | |
| SSO / SCIM | **Plans** (8.3) | |

---

## Top 10 inspirations (ranked by value for effort)

Two vocabulary points apply to every row. Islestone never uses Procore's names (RFI, Submittal, Punch List, Ball in Court, Helix, Assist and so on). And ADR 0006 rule 1 requires a vocabulary row *before* a new concept's first model or label. Several otherwise natural words are already taken:

- "Workflow" means a team's workflow states only (rule 6).
- "Approve, Edit and approve, Reject" belong to proposals.
- "Responsible" is a banned synonym for assignee.
- "Checklist item" is a banned synonym for sub-item.
- "Group" is SCIM's word.
- "Attachment" means a file.

### 1. "Waiting on": whose move it is, separate from who is accountable — **S–M**
- **Idea.** A nullable `waitingOn` actor on a work item: a member, a guest (from 8.4), or "the delegate's agent session". It is set by state changes, review steps (#5) or by hand. The assignee stays the one accountable person (ADR 0003 §1). This field answers a different question: who must act next.
  - Show it as a column, filter and swimlane.
  - Count time-waiting-on per party in analytics (3.6).
  - Feed My Work ("waiting on me") and the overdue reminders.
- **Why it fits.** It maps cleanly onto agent sessions: an `AgentSession` in `awaiting input` means waiting on its assignee, so an agent's question to a person surfaces in the same place as a human hand-off. Guests in 8.4 need exactly this ("the ball is with the outside party").
- **Where.** Extends 2.2 (field and usecase), 2.4 (filters) and 2.7 (My Work section). Time-waiting metrics land in 3.6.
- **Conflicts.**
  - Needs an ADR 0006 row with a fresh word; "Responsible", "Owner" and "Assignee" are not available.
  - Must not become a second assignee, which ADR 0003 §1 forbids.
  - A versioned field, so it follows the `If-Match` rules.

### 2. Per-type field sets: required, optional or hidden fields per work item type — **M**
- **Idea.** Today custom fields are planned per *project* (2.4). Add a per-workspace or per-project layout saying, for each `WorkItemType`, which built-in and custom fields are required, optional or hidden. This is Procore's Correspondence fieldset idea. A "Question" type then shows question, answer and due date; a "Defect" type shows location and severity.
- **Why it fits.**
  - It is how one table can serve every kind of record Procore splits into tools, without new tables (principle 3).
  - It also gives agent proposals a schema to be validated against: a required field missing means the proposal is refused.
- **Where.** Extends 2.4; it is the prerequisite for #3 and #6.
- **Conflicts.** ADR 0002 §1 says "Types carry no behaviour", so this needs an amendment to ADR 0002 (and to ADR 0006 if it is named, for example "field layout"). Validation of required fields must live in the usecase, not only in the UI.

### 3. Question items with a marked answer, and an agent that drafts answers — **S once #1 and #2 exist; agent part in Phase 7**
- **Idea.** A seeded "Question" work item type: question body, due date, waiting-on (#1), several replies (comments), one of which a person marks as **the answer**. Marking it moves the item to `DONE` and notifies the distribution (#4). The answer is a pointer from the item to a comment.
- **Agent part.** On a new question, the delegate agent searches the knowledge index (6.5), drafts an answer **citing item and page ids**, and submits it as a proposal. The person approves it as their reply or edits it.
- **Why it fits.** This is Procore's RFI Creation Agent pattern, but Islestone's version is stricter: proposals, citations required (H7 groundedness check), and the assignee stays accountable.
- **Where.** Type and template in 2.5; the "mark as answer" field in 2.2/2.4; the agent skill as a new Phase 7 sub-phase, or an extension of 7.2 triage.
- **Conflicts.** A new vocabulary row for "answer". Comment edit and delete rules (owner decision 53) must cover a comment marked as the answer: deleting it should clear the mark, or be refused.

### 4. Distribution groups: named sets of people to notify — **S**
- **Idea.** Named, workspace- or project-scoped sets of members (later guests) that can be added to an item's watchers in one step, used as a notification target by automation rules (5.1), and attached to a report or meeting minutes (#7, #9).
- **Why it fits.** Watchers already exist; this removes the "add 12 people by hand" step, which matters most once external collaborators arrive in 8.4. Notifications must still respect each member's preferences (2.7) and project visibility.
- **Where.** Extends 2.2 watchers and 2.7 notifications; becomes a target in 5.1.
- **Conflicts.** A new ADR 0006 row; "Group" is reserved for SCIM. A new tenant table needs RLS, a two-tenant test and `ISOLATION_TESTED`. The recipient check must re-check liveness and visibility at send time (the cross-tenant recipient guard pattern).

### 5. Review steps on a work item: sequential or parallel reviewers, with rounds instead of rewinds — **L**
- **Idea.** An item can carry an ordered set of review steps. Each step names reviewers (people or a distribution group), says whether all or any must respond, and sets a due date in working days. Waiting-on (#1) moves to the step's reviewers, and moves on when the step completes. A returned review starts a **new round** that keeps the earlier round's record; it does not rewind. Procore's own guidance favours revisions over reverts for honest reporting.
  - Templates of review steps per item type (2.5).
  - Conditional steps (for example, add the legal step when a field exceeds X) can come later through 5.1 conditions.
- **Why it fits.** It is the human analogue of Islestone's proposal approvals. It reuses the review page, notifications and audit trail. It makes Islestone credible for document review, design sign-off and change approval.
- **Where.** A new sub-phase, best after 2.5 and alongside 5.1 (for example "2.8 Reviews"), or as part of 5.1's builder.
- **Conflicts.**
  - ADR 0002 §3: "No reviewer gate in this ADR". Needs an ADR amendment or a new ADR.
  - ADR 0006: "Workflow" is reserved, so this cannot be called an approval workflow. Approve/Reject belong to proposals, so the outcomes need distinct words ("Approved for use" / "Returned"?) and their own rows.
  - It must not let an agent count as a reviewer, which would cut across ADR 0003. At most an agent drafts a review comment as a proposal.

### 6. Checklist runs: templated pass/fail checks that open follow-up items — **M**
- **Idea.** A checklist template is a list of lines. Each line has a result (pass / fail / not applicable), an optional note and photo, and an optional evidence requirement (photo, signature). Running one against a project creates a run record. A failed line **creates a linked work item** (or proposes one) carrying an origin link back to the run. A line can be marked so that failing it *requires* a follow-up item.
  - Optional hold points (from Action Plans): a required sign-off blocks later sections.
  - A completed run produces a PDF record sent to a distribution group (#4).
- **Uses beyond construction.** Release checklists, onboarding, QA passes, launch readiness, audits.
- **Why it fits.** It is deterministic structure that agents can fill. An agent can pre-fill a run from evidence and propose results, and a person signs.
- **Where.** A new sub-phase after 2.5 (templates) and 4.4 (files for photo evidence).
- **Conflicts.** ADR 0006 bans "Checklist item" as a synonym for sub-item, so this concept needs clearly separate words (for example "Checklist", "Check", "Check result") added by amendment. New tenant tables need RLS. Signatures need the encryption and PII rules if they store a drawn signature.

### 7. Periodic structured reports: an agent drafts, a person files — **M**
- **Idea.** A project can have a report template (daily, weekly or per cycle) with sections:
  - deterministic sections computed by code: completed, started, blocked, slipped, time logged (3.4), items opened from checklists;
  - free-text sections people fill;
  - sections contributed by guests (subcontractor-style entries).
  
  An agent drafts the free-text summary *from the computed facts only*, with a link per claim, and flags missing or conflicting entries. A person finalises it, which files an immutable report row and sends it to a distribution group.
- **Why it fits.** It is principle 4 exactly ("deterministic numbers, explained by a model"). It turns 7.4's digest into a filed record people sign off, which is what Procore's Daily Log Agent does.
- **Where.** Extends 7.4. The report record itself could land earlier, after 3.4 and 3.6.
- **Conflicts.** None found. It needs H7's groundedness check, and an ADR 0006 row ("Report" may collide with the banned synonym for View: "Report" is listed under View's words not to use). Pick another word, or amend.

### 8. Event triggers for delegate agents, with citations and consent — **S–M on top of planned 6.3**
- **Idea.** Procore's May 2026 "Actions + Triggers" split maps onto Islestone. 6.3 already plans invocation by mention, schedule or automation. Take two specifics:
  - **Per-type default delegate triggers.** "When a Question item is created in project P, start agent A as its delegate", configured by a person who holds the rights. Each run cites its sources.
  - **A "deep search" read skill** across items, pages and files, with citations.
  
  Keep Islestone's stricter rules: proposals at every rung for sessions someone other than the assignee started (ADR 0003 decision 10), budgets and kill switch.
- **Why it fits.** It validates the roadmap's direction: the market leader in this vertical converged on agents behind human consent. Islestone can differentiate on the per-item accountable person and the auditable proposal trail.
- **Where.** 6.3 (the trigger, already planned through 5.1 → 6.3) and 6.5/7.x for the search skill.
- **Conflicts.** Trigger-started sessions are by definition not started by the assignee, so they propose at every rung. That is intended.

### 9. Meeting series: agenda, carry-forward of open points, distributed minutes — **M**
- **Idea.** A meeting record per series with agenda points linked to work items. Open points carry into the next meeting automatically. Minutes are distributed to a distribution group (#4), and new actions become work items or, via 7.6, proposals.
- **Why it fits.** 7.6 already plans transcript → decisions and actions as proposals. A meeting record gives those proposals a home and a history, and the carry-forward is cheap and much liked.
- **Where.** Extends 7.6, or a new small sub-phase before it (after 4.1 pages).
- **Conflicts.** A new vocabulary row ("Meeting", "Agenda point"). Transcript text is a new kind of encrypted content, and audio stays deferred (7.6, 9.3).

### 10. Project permission templates for external collaborators, and their company — **M**
- **Idea.** For 8.4, take three things:
  - **Project-scoped templates.** Per area (work items, pages, files, canvas, reports), a level of none, read, contribute or manage, applied when inviting a guest to a project.
  - **An "assignable" subset** project admins may hand out.
  - **An external-organisation tag** on guests (which outside firm they belong to), so items can be waiting on that firm and reports can group by it.
- **Why it fits.** 8.4 promises "project-level roles, guest access limited to named projects". Procore's maturity here is the strongest evidence of what external-collaborator projects need.
- **Where.** 8.4 (and H2's permission matrix).
- **Conflicts.**
  - Islestone's `PermissionSet` and custom roles are the base; reuse `TenantCustomRole` patterns rather than invent a parallel template system.
  - ADR 0006: "Company" and "Account" are banned words for the organization concept, and "Collaborator" for member. The external firm needs its own row and word.
  - `visibleProjects` currently returns none for GUEST, by design until 8.4.

---

## Other candidates

| Idea (Islestone terms) | Where | Size | Note |
|---|---|---|---|
| **Pins**: link a work item to a point or region on an uploaded image or PDF, or a canvas shape, and create an item from a pin | 4.2 (canvas already links items), 4.4 (previews) | M–L | tldraw stays on 3.x with the watermark (ADR 0001 D3). PDF pin overlays are new work. |
| **Revision compare** for file versions (image/PDF overlay) | 4.4 | M | Only if file versions are added. |
| **File versions with "latest always"** and per-folder permissions | 4.4 | M | Per-folder ACLs interact with project visibility and RLS; keep them project-scoped. |
| **Photos** with album and location fields, captured from mobile into an item | 4.4, 8.5 | M | Location means EXIF/GPS, which is personal data. Strip EXIF or classify it under the encryption manifest rules. |
| **Convert an item's type keeping links and history** (Procore escalates a coordination issue into an RFI) | 2.2/2.4 | S | Interacts with per-type field sets (#2): conversion must satisfy the new type's required fields. |
| **Overdue rules by state** (for example only overdue while in "Work required") | 2.2 reminders | S | Small extension of the due-date job. |
| **Lookahead** as a saved timeline view (next N weeks, chosen states) | 2.4 + 3.1 | S | Pure configuration once views and timeline exist. |
| **MS Project (.mpp) / P6 (.xer) import** into items with dependencies | 5.5 | M | Useful to non-construction PMOs too; parse into the 3.1 engine's plain data. |
| **Change requests with impact**: a "Change" type with cost/hours/schedule impact fields, routed through review steps (#5); approval adjusts estimates or budgets | After 3.4 and #5 | L | A generic version of change events → change orders. Full commitments and contracts stay out. |
| **Signed completion record** (PDF) of a checklist run, report or review round sent to recipients | With #5–#7 | S | Uses the existing outbox. |
| **BI export** (read-only dataset or connector for Power BI / Looker) | 3.6 / 5.2 | M | Must respect RLS and encryption. A read replica route exists in the inherited pattern (`DATABASE_READ_URL`). |
| **Guest contributions to a report** (outside firms add their section) | #7 + 8.4 | S | |
| **AI credit pool shared across projects** as a pricing model | 8.1, owner decision 7 | — | Input to an open owner decision, not a build item. |
| **No-code agent builder** (describe an agent in natural language) | After 6.6 | L | Islestone would gate it through skills with evaluation records and second-person approval, never a free-form action catalogue. |

---

## Not a fit

- **Financial suite**: prime contracts, commitments, progress billing, Procore Pay, lien waivers. Construction accounting; far outside a PM product, and it would add a regulated payments surface.
- **Bid management and subcontractor prequalification.** Procurement for a trade marketplace, not project management.
- **BIM / 3D model coordination.** Domain-specific viewers and formats.
- **Drawing-sheet management** (sheet numbering, title-block OCR, sheet sets). Construction document control; generic file versions and pins cover the transferable part.
- **Daily-log weather, manpower, deliveries, visitors and equipment sections.** Jobsite-specific. Take only the generic "configurable sections, agent drafts, person files" shape (#7).
- **Crews, T&M tickets, cost codes on timesheets.** Field-labour accounting. 3.4 and 3.5 cover the generic part.
- **A separate tool per record kind, each with hard-coded statuses.** Contradicts principle 3 and ADR 0002 (one table, types plus team workflow states). Take the behaviours, not the structure.
- **Pricing by construction volume with unlimited users.** Construction-specific metric. Islestone's 8.1 is seat-based and AI usage is metered.
- **Power BI as the analytics engine.** A licence dependency and a data-egress path. 3.6 builds analytics in-house on the visx charts.
- **A broad agent action catalogue that writes directly once consented.** Islestone's model is stricter: proposals per change, the rung ladder and assignee-started sessions (ADR 0003 decisions 9 and 10). Do not dilute it to match.
- **Procore's names and branding** (RFI, Submittal, Punch List, Ball in Court, Helix, Assist, Digital Coworker). Proprietary product vocabulary, and ADR 0006 needs Islestone's own words anyway.
- **Near-copies of the punch-item coordination flow.** Search surfaced US patents 11,188,858 and 12,443,904 on coordinating punch items; the second was summarised as Procore's, but I did not verify the assignee. Islestone's generic states plus review steps differ in shape, but have counsel look before building anything closely modelled on that flow.
- **Offline-first field mobile now.** ADR 0005 (E0) and 9.3 defer offline. Keep it deferred unless 8.5 quick capture makes it a requirement (ADR 0005 open question 9).

---

## Sources

Procore support and product pages (reached through search results; not fetched directly):
- https://support.procore.com/products/online/user-guide/project-level/rfi/tutorials/respond-to-an-rfi
- https://v2.support.procore.com/product-manuals/rfi-project/permissions
- https://support.procore.com/products/online/user-guide/project-level/submittals/best-practices-submittals/best-practices-submittal-workflow-management
- https://support.procore.com/products/online/user-guide/project-level/submittals/tutorials/change-the-ball-in-court-on-a-submittal
- https://support.procore.com/product-releases/new-releases/submittals-rollout-of-new-submittal-workflow-for-approvers
- https://support.procore.com/faq/what-is-the-punch-list-work-flow
- https://support.procore.com/faq/inspection-requirements-general-faq
- https://support.procore.com/products/online/user-guide/project-level/inspections/tutorials/create-an-observation-from-an-inspection
- https://support.procore.com/products/online/user-guide/project-level/observations/tutorials/create-an-observation
- https://v2.support.procore.com/en-ca/process-guides/assets-user-guide/create-observation
- https://support.procore.com/products/online/user-guide/project-level/action-plans/tutorials/create-an-action-plan
- https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/daily-log-overview
- https://v2.support.procore.com/product-manuals/daily-log-project/tutorials/daily-log-types
- https://www.procore.com/en-gb/project-management/meetings
- https://procoretest.skilljar.com/meetings-tool-gc
- https://support.procore.com/products/online/user-guide/project-level/correspondence
- https://v2.support.procore.com/en-ca/process-guides/getting-started-correspondence/create-a-correspondence-type
- https://v2.support.procore.com/product-manuals/workflows-company/tutorials/create-a-custom-workflow-template-for-prime-contracts
- https://support.procore.com/products/online/user-guide/project-level/drawings/tutorials/create-or-link-rfis-on-a-drawing
- https://support.procore.com/products/online/user-guide/project-level/drawings/tutorials/link-items-on-a-drawing
- https://support.procore.com/products/online/user-guide/project-level/drawings/release-notes/2020
- https://www.procore.com/platform/document-management
- https://en-au.support.procore.com/products/online/user-guide/project-level/documents
- https://support.procore.com/products/online/user-guide/project-level/schedule
- https://v2.support.procore.com/product-manuals/scheduling-project/tutorials/import-a-read-only-project-schedule/
- https://www.procore.com/whats-new/procore-scheduling-comes-to-mobile
- https://support.procore.com/products/online/user-guide/project-level/change-events
- https://v2.support.procore.com/process-guides/general-contractor-financial-management-user-guide/change-management-tools
- https://www.procore.com/cost-management/general-contractors
- https://www.procore.com/design-coordination/coordination-issues
- https://www.procore.com/whats-new/manage-bim-coordination-issues-faster-with-procore-ai
- https://en-au.support.procore.com/product-releases
- https://support.procore.com/products/online/user-guide/company-level/permissions
- https://support.procore.com/products/online/user-guide/company-level/permissions/tutorials/create-a-project-permissions-template
- https://support.procore.com/products/online/user-guide/project-level/directory
- https://en-ca.support.procore.com/products/online/user-guide/project-level/directory/overview
- https://support.procore.com/products/online/user-guide/company-level/analytics
- https://support.procore.com/products/online/user-guide/company-level/analytics/tutorials/procore-analytics-embedded-2.0
- https://v2.support.procore.com/product-manuals/timesheets-ios
- https://www.procore.com/products
- https://support.procore.com/procore-mobile-ios/user-guide/sidebar-screen/tutorials/sync-priority-data-on-the-procore-mobile-app-ios
- https://apps.apple.com/us/app/procore/id374930542
- https://support.procore.com/products/procore-api
- https://procore.github.io/documentation/introduction
- https://procore.github.io/documentation/oauth-introduction
- https://support.procore.com/faq/common-questions-apps-and-marketplace
- https://support.procore.com/products/online/user-guide/project-level/assist/about-assist
- https://v2.support.procore.com/faq-what-data-can-assist-access
- https://v2.support.procore.com/en-au/product-manuals/procore-ai/tutorials/about-procore-ai
- https://support.procore.com/products/online/procore-ai/tutorials/create-an-agent-in-procore

Procore press, blog and partner releases:
- https://www.procore.com/blog/inside-procores-2025-innovation-summit-and-the-future-of-connected-construction
- https://www.businesswire.com/news/home/20251015796723/en/Procore-Advances-the-Future-of-Construction-with-New-AI-Innovations-at-Groundbreak-2025
- https://www.procore.com/press/new-procore-ai-experience-embeds-datagrid-into-procore
- https://www.businesswire.com/news/home/20260521183451/en/New-Procore-AI-Experience-Embeds-Datagrid-into-Procore
- https://datagrid.com/release-notes/procore-ai-digital-coworker-packages-now-available
- https://datagrid.com/release-notes/procore-ai-and-datagrid-automate-agents
- https://aecmag.com/news/procore-cde-lays-foundation-for-agentic-ai
- https://pulse2.com/procore-acquires-datagrid-to-expand-agentic-ai-and-connect-construction-data-across-platforms/
- https://www.enr.com/articles/61650-procore-groundbreak-2025-marks-leadership-shift-ai-push

Third-party, reviews and competitors (lower confidence):
- https://www.trustradius.com/products/procore/pricing
- https://www.g2.com/products/procore/features
- https://www.followupcrm.com/blog/how-to-change-ball-in-court-in-procore
- https://www.docsie.io/tutorials/procore/respond-to-an-rfi/
- https://kbd.group/procore-manual/change-events/
- https://planera.io/post/procore-alternatives
- https://www.marketscale.com/industries/engineering-and-construction/procores-ai-go-app-lets-jobsite-crews-ask-their-project-data-out-loud.md
- https://www.cimdata.com/en/industry-summary-articles/item/30118-new-procore-ai-experience-embeds-datagrid-into-procore
- https://www.usecarly.com/blog/claude-procore-integration/
- https://www.ingenious.build/ingenious-vs-procore-mcp
- https://downtobid.com/blog/building-connected-vs-procore-vs-downtobid
- https://patents.justia.com/patent/11188858
- https://patentsgazette.uspto.gov/week41/OG/html/1539-2/US12443904-20251014.html

Islestone files read (read-only): `/home/user/islestone/docs/ROADMAP.md`, `/home/user/islestone/CLAUDE.md`, `/home/user/islestone/docs/adr/README.md`, `/home/user/islestone/docs/adr/0002-work-item-model.md`, `/home/user/islestone/docs/adr/0003-assignee-and-delegate.md`, `/home/user/islestone/docs/adr/0005-data-sync-strategy.md`, `/home/user/islestone/docs/adr/0006-vocabulary.md`, `/home/user/islestone/docs/work-items.md`.
