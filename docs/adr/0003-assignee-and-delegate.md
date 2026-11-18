# 0003 — Assignee and delegate

Status: Proposed — awaiting owner sign-off (2026-11-18 drafted). Open questions 8, 9 and 10, and that agents have no risk tier (section 4), were decided by the owner on 2026-11-18; the other open questions await sign-off.

## Context

Roadmap principle 1: people are accountable and agents are delegated. A work item has one human assignee and, optionally, one agent delegate. Principle 2: agents propose and people approve; every agent write goes through the proposal queue until a workspace owner raises a specific rung.

Roadmap 2.2 (idea 1) takes this from the field: the agent gets a session, an activity stream, a budget with a hard stop and a review gate. Roadmap 2.4 says to build the delegate, session and activity model in-house on the inherited engine, rather than adopt an agent framework. Roadmap 6.1 ports the engine, 6.2 the proposal queue, and 6.3 builds the delegate model.

This ADR fixes the rules before those phases. It uses the words in ADR 0006 and the work-item model in ADR 0002. In this ADR, "session" alone always means an agent session, the short form ADR 0006 rule 5 allows in prose once a document has defined it; a person's browser session is always called a sign-in session. Like ADR 0002, it writes `tenantId` and `TenantMembership`, following ADR 0006's recommended option W1. The schema sketch is illustrative, not final.

How to read this ADR: a line marked **Verified** was read in the named source on 2026-11-18. Everything else is a recommendation or an open question.

### External patterns

- **Linear.** Read from the type definitions of `@linear/sdk` 103.0.0 (MIT, from the npm registry), file `dist/index-BNMxzn7u.d.mts`. Facts only; nothing is copied.
  - **Verified.** Agent session statuses (lines 570–578): `pending`, `active`, `awaitingInput`, `complete`, `error`, `stale` and `stopping`. The roadmap's six states are these, without `stopping`.
  - **Verified.** Agent activity types (lines 335–342): `action`, `elicitation`, `error`, `prompt`, `response`, `thought`.
  - **Verified.** Activity signals (lines 320–325): `auth`, `continue`, `select`, `stop`.
  - **Verified.** An issue's delegate is typed `User` (type `Issue`, lines 6971 and 7018–7019), documented as "The agent delegated to work on the issue. Null if no agent is delegated." In Linear, an agent is a kind of user.
  - **Not read.** Linear's written agent guidelines. This session's network refused `linear.app`. What this ADR says about them comes from roadmap 2.2.
- **Paperclip** (MIT, a roadmap port candidate). Roadmap 2.2 describes its agent, goal, budget, heartbeat and run schema with atomic checkout locks. **Not read here.** This ADR takes the ideas from the roadmap's description. Before any of its code is used, H0 requires its LICENSE to be re-read and its commit pinned in `PROVENANCE.md`.
- **Plane Agents** (AGPL, inspiration only) and **Jira agents.** Named in roadmap 2.2. Not read. No code from Plane may be copied in any case.

### What inflect-compliance's agent engine does

Read at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`. Phase 6 plans to port these. ADR 0001 D1 (owner decision, 2026-11-18) allows copying them, with a `PROVENANCE.md` row for every copied file; this ADR read them for their design and copied nothing.

- **Verified.** An agent is a `RegisteredAgent` row, separate from `User`, with a required `ownerUserId`, "the accountable human" (`prisma/schema/agentic.prisma` lines 740–800). Its status is `DRAFT`, `ACTIVE`, `SUSPENDED` or `RETIRED`; `DRAFT` cannot run (`prisma/schema/enums.prisma` lines 2091–2099).
- **Verified.** Ownership moves only by a two-step transfer: only the named recipient completes it, and the initiator never can (`agentic.prisma` lines 3202–3215).
- **Verified.** The proposal queue, `AgentProposal` (`agentic.prisma` lines 5–237; `src/app-layer/usecases/agent-proposals.ts` lines 1–18):
  - an agent's proposal is validated against the same Zod schema as the REST route and sanitised before it is queued;
  - approval is a human action that runs the real create usecase, then records both the person and the agent;
  - payload and rationale are encrypted at rest;
  - `operation` is `CREATE` or `UPDATE`; an `UPDATE` must name a target (a CHECK), and a target deleted under a pending proposal is refused at approval as `TARGET_MISSING`;
  - each row pins the policy-card version in force, the number of approvals required (enforced by a trigger) and an expiry deadline swept by a job;
  - `runId` and `stepSeq` trace a proposal to the step that produced it;
  - an output guard writes a verdict on every proposal; a quarantined proposal never reaches the review queue;
  - a separate table samples approved proposals for a second person to check (`agentic.prisma` lines 239–265).
- **Verified.** The usecase exports `createAgentProposal`, `approveAgentProposal`, `rejectAgentProposal` and `bulkRejectAgentProposals` (`agent-proposals.ts` lines 929, 1656, 2280, 2407).
- **Verified.** The kill switch (`src/lib/agentic/kill-switch.ts` lines 1–80; `agentic.prisma` lines 1772–1861):
  - three scopes, platform over tenant over agent;
  - checked at every tool call, uncached, in one indexed query;
  - a kill is a history row that is lifted, never deleted;
  - it cannot undo committed writes or un-queue proposals;
  - a system-only code, `OWNER_DEPARTED`, marks a kill the owner-orphan pass engaged; its lift needs a completed ownership transfer.
- **Verified.** inflect-compliance's `CLAUDE.md` ("Every model call is preceded by the kill switch and the caps", #4196) says the kill switch is also checked before every model call. Checking only at tool calls had let a killed run call the model again and settle as completed.
- **Verified.** Policy cards are versioned, append-only limits per agent: permitted tools (which can only narrow the grants), maximum data scope, maximum autonomy, actions per run and per day, escalation triggers and an approval rung. The daily counter is reserved before the call, "so two concurrent calls cannot both read the same number and both be admitted" (`agentic.prisma` lines 1235–1354, especially 1249–1252).
- **Verified.** Run caps charge all or nothing; a cap halts a run and never truncates its work; the engine's and the card's ceilings combine by taking the stricter (`src/lib/agentic/run-caps.ts` header).
- **Verified.** The monthly token budget is checked once before a run: if spent tokens plus the run's token cap exceed the budget, the run is refused. A missing budget means unlimited (`src/lib/agentic/monthly-budget.ts` lines 1–47).
- **Verified.** A reaper moves wedged runs to failed. It walks every page rather than a capped prefix, isolates failures, and leaves runs that wait for a human alone however old they are (`src/app-layer/jobs/agent-run-reaper.ts` lines 1–50).
- **Verified.** Automation rules run as the real membership of a named person, never a fabricated admin (`docs/implementation-notes/2026-08-12-automation-actor-authority.md` lines 1–30). Jobs acting for a person resolve that person's membership when they run (`src/app-layer/context-system.ts` line 346, `resolveMemberContext`).
- **Verified.** inflect-compliance's `CLAUDE.md` records that an API key bound to an agent answers to that agent's kill switch and status on REST routes too (#4481), and that write-once tables with encrypted columns must still admit the key-rotation re-wrap ("A2A messaging").

## Decision

### 1. The assignee: one accountable person

- `WorkItem.assigneeId` names at most one person. It is null when the item is unassigned.
- It references the membership, not just the user: a composite foreign key `(tenantId, assigneeId)` → `TenantMembership(tenantId, userId)`. An agent can never be an assignee, because an agent has no membership.
- **Removing a member** is one transaction, in this order, each step audited:
  1. for each item assigned to them that has a delegate: end the item's live agent session (`COMPLETE`, reason `ASSIGNEE_REMOVED`) and clear `delegateAgentId`, which the CHECK in section 2 requires before the assignee can be cleared;
  2. unassign every item assigned to them;
  3. suspend the agents they own and end those agents' remaining live sessions (section 3, "Owner leaves");
  4. delete the membership.
  The foreign key is `RESTRICT`, so a removal path that skips step 2 fails instead of leaving a dangling assignee, and the CHECK makes a path that skips step 1 fail too. The person removing the member sees the delegated items in the confirmation, so nobody is surprised that those agents stopped.
- A deactivated member stays assigned and is shown as inactive, so the item is visibly in need of a new assignee.
- A guest can be assigned only items in projects they can access (roadmap 8.4).
- Roadmap 2.1 creates `assigneeId`. The delegate column arrives with the `Agent` table in roadmap 6.3.

### 2. The delegate: at most one agent

- `WorkItem.delegateAgentId` names at most one agent, through `(delegateAgentId, tenantId)` → `Agent(id, tenantId)`.
- **A delegated item always has an assignee:** `CHECK (delegateAgentId IS NULL OR assigneeId IS NOT NULL)`.
  - Delegating an unassigned item makes the person delegating its assignee in the same write, if they may be assigned.
  - Clearing the assignee of a delegated item is refused (409, `DELEGATE_NEEDS_ASSIGNEE`). The person picks a new assignee or ends the delegation first.
- Only an `ACTIVE` agent can be made a delegate.
- Two accountabilities, kept apart:
  - the **assignee** answers for the work on the item;
  - the **agent owner** answers for the agent itself: its configuration, its limits and its behaviour everywhere.
- Changes and their effect on a live session (section 5):

| Change | Delegate field | Live session |
|---|---|---|
| Delegate cleared | cleared | ends `COMPLETE`, reason `ENDED_BY_PERSON` |
| Delegate changed to another agent | new agent | old session ends `COMPLETE`, reason `DELEGATE_CHANGED` |
| Assignee changed | kept | ends `COMPLETE`, reason `ASSIGNEE_CHANGED`. The new assignee becomes accountable for the item without having chosen this session, so it does not carry on under them; they restart it if they want. |
| Assignee removed with their membership (section 1) | cleared | ends `COMPLETE`, reason `ASSIGNEE_REMOVED` |
| Item moved to a `DONE` or `CANCELLED` state | kept | ends `COMPLETE`, reason `ITEM_CLOSED` |
| Item deleted | kept, hidden | ends `COMPLETE`, reason `ITEM_DELETED` |

### 3. The agent: an actor, not a user

- `Agent` is its own model. It has no `User` row, no membership, no password and no sign-in session, and it never counts as a seat. It appears beside members in the delegate picker only.
- This differs from Linear, where the delegate is a `User`. Islestone separates them (roadmap 6.3) because a user row carries sign-in, sign-in sessions, seats and memberships that an agent must never have, and because accountability needs a required human owner that a user row does not carry.
- **Owner.** `Agent.ownerUserId` is required. It must be an active member when written. It moves only by a two-step transfer in which only the named recipient completes step two (the inflect-compliance pattern; pattern only, no code copied).
- **Owner leaves.** The member-removal usecase suspends every agent they own in the same transaction and ends those agents' live sessions (`ERROR`, reason `OWNER_DEPARTED`). It runs after the removed member's own items are unassigned (section 1), so a session on an item they were assigned ends `ASSIGNEE_REMOVED`, and only their agents' sessions on other people's items end `OWNER_DEPARTED`. A completed transfer to a new owner lets someone reactivate the agent. inflect-compliance does this in a nightly pass driven by HR data; Islestone has no HR feed in scope, so the removal itself is the signal.
- **Status:** `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`. Only `ACTIVE` agents are delegated or invoked.
  - `SUSPENDED` is reversible. Live sessions end `ERROR`, reason `AGENT_NOT_ACTIVE`. Delegate fields stay.
  - `RETIRED` is terminal (a trigger refuses any move out). One transaction ends the agent's sessions, clears its delegate fields (audited), and revokes its API keys. The status is written first and the audit last, as in inflect-compliance's retirement cascade.
- **Kinds:**
  - `ENGINE`: runs on Islestone's engine (roadmap 6.1) and has agent runs.
  - `EXTERNAL`: a customer's own agent that connects through the MCP server (roadmap 6.2, 7.7) with an API key bound to the agent. It has sessions and activity, and no runs.
- An API key bound to an agent answers to that agent's status and kill switch on every surface, MCP and REST alike.

### 4. What an agent may do: authority only narrows

- An agent session's authority is the **intersection** of:
  - the agent's tool grants;
  - its policy card (tools, data scope, autonomy, action counts);
  - the permissions of the **authorising person**, including a guest's project limits.
- **No risk tier. Owner decision, 2026-11-18; the owner chose "Drop it".** Islestone's agents have no risk tier: every agent is governed by its grants and its autonomy rung alone, narrowed as above. There is no tier column, and no autonomy ceiling, approval count, policy-card default or review cadence is derived from one. inflect-compliance's tier and what it drives are not ported; the 6.1 and 6.2 porting maps (`docs/porting/maps/`) name what replaces each behaviour that depended on it.
- The authorising person depends on how the session started:

| Invocation | Authorising person |
|---|---|
| Delegation | the person who delegated |
| Mention | the person who mentioned the agent |
| Schedule | the agent owner |
| Automation | the rule's accountable author, resolved as in inflect-compliance's automation-authority fix (pattern only) |

- **The authorising person need not be the item's assignee.** A teammate may delegate an assigned item, or mention an agent on it, without being its assignee. That is acceptable for three reasons, and the rules below hold it:
  - the agent can never do more than the authorising person could do themselves (the intersection above), so starting a session grants no one extra reach;
  - outside its own record, everything the agent changes is a proposal routed to the item's assignee (decision 8 below; section 8), so the assignee still decides what lands on their item. This holds even for a tool a workspace owner has raised to `AUTOMATIC` (decision 10 below);
  - the assignee is notified when someone else starts a session on their item, and may end it at once (`COMPLETE`, reason `ENDED_BY_PERSON`).
- **Decided (open question 8). Owner decision, 2026-11-18; the owner chose "Run now, assignee notified".** A session that someone other than the assignee starts on an item runs at once, within the starter's permissions (the intersection above). Every write it makes outside its own record is a proposal routed to the assignee, and the assignee is notified and can end the session. The alternative, holding the session in `PENDING` until the assignee consents, was not chosen.
  Who may start a session on someone else's item at all is still open question 2.
- The authorising person's membership and role are re-read at session start and at the start of every run. If they no longer hold the authority, the session ends `ERROR`, reason `INVOKER_NOT_AUTHORISED`. A role change during a run applies from the next run; the run's wall-clock cap bounds the gap.
- **At the `PROPOSE` rung, direct writes are limited to the agent's own record.** An agent may write, without a proposal:
  - activity entries in its own live session (section 6);
  - its own session's moves listed in section 5, and its heartbeat.
- **Everything else is a proposal** while the tool is at the `PROPOSE` rung, where every tool starts: creating or changing items, comments, relations, plans and schedule changes. A proposal is decided by a person, and the real usecase then runs as that person (section 8). A tool a workspace owner has raised to `AUTOMATIC` writes directly (section 9), except in a session that someone other than the item's assignee started: that session's writes are proposals routed to the assignee (decision 8 above, held at every rung by decision 10 below).
- **Decided (open question 10). Owner decision, 2026-11-18; the owner chose "Proposals to assignee".** A session started by someone other than the work item's assignee never writes directly, whatever the rung: even where a workspace owner has raised a tool to `AUTOMATIC`, that session's writes go to the assignee as proposals. Decision 8 wins over decision 9 for such sessions. A session the assignee started follows the rung (decision 9, section 9).

### 5. Agent sessions and their states

An agent session is one engagement of one agent, usually on one work item. States, as in roadmap 6.3:

| State | Meaning |
|---|---|
| `PENDING` | Invoked; the agent has not acknowledged. |
| `ACTIVE` | Working. |
| `AWAITING_INPUT` | Waiting for a person: an answer to a question, or a decision on a proposal. |
| `COMPLETE` | Ended without failure. `endReason` says how. |
| `ERROR` | Stopped by a failure or a control. `endReason` says which. |
| `STALE` | Went silent and was reaped. |

Allowed moves:

| From | To | By | When |
|---|---|---|---|
| `PENDING` | `ACTIVE` | agent | it acknowledges (first activity, or the checkout call) |
| `ACTIVE` | `AWAITING_INPUT` | agent | it asks a question (`ELICITATION`) or its proposal awaits a decision |
| `AWAITING_INPUT` | `ACTIVE` | person | they answer (a `PROMPT` entry), or the proposal is decided |
| `ACTIVE` | `COMPLETE` | agent | it posts its final `RESPONSE` |
| any live state | `COMPLETE` | system | a person ends it, or a change in section 2 ends it |
| any live state | `ERROR` | system | kill switch, budget or cap stop, authority lost, agent not active, run failed |
| `PENDING` | `STALE` | reaper | not acknowledged in time (recommended: 10 minutes) |
| `ACTIVE` | `STALE` | reaper | no heartbeat in time (recommended: 30 minutes, and always longer than an engine run's wall-clock cap) |

Rules:

- `COMPLETE`, `ERROR` and `STALE` are terminal. A trigger refuses any move out of them. A new invocation creates a new session.
- `AWAITING_INPUT` never goes stale. Waiting for a person is legitimate, as inflect-compliance's reaper recognises.
- `endReason` is a closed list with a CHECK per terminal state:
  - `COMPLETE`: `FINISHED`, `ENDED_BY_PERSON`, `DELEGATE_CHANGED`, `ASSIGNEE_CHANGED`, `ASSIGNEE_REMOVED`, `ITEM_CLOSED`, `ITEM_DELETED`;
  - `ERROR`: `KILLED`, `BUDGET_EXHAUSTED`, `CAP_REACHED`, `INVOKER_NOT_AUTHORISED`, `AGENT_NOT_ACTIVE`, `OWNER_DEPARTED`, `RUN_FAILED`;
  - `STALE`: `NOT_ACKNOWLEDGED`, `NO_HEARTBEAT`.
- Success metrics count `COMPLETE` with `FINISHED` only.
- **No `stopping` state.** Linear has one. In Islestone the server is the authority: a person's stop moves the session to a terminal state at once, the agent's next call is refused, and an engine run reads the session's state before every model call and every tool call, as it reads the kill switch. See open question 1.
- The reaper walks every page and isolates failures, in the pattern of inflect-compliance's run reaper. Pattern only.

### 6. Agent activity: append-only

- `AgentActivity` holds the session's entries in order, numbered by `seq` within the session.
- Types: `PROMPT`, `THOUGHT`, `ACTION`, `ELICITATION`, `RESPONSE`, `ERROR`. These are Linear's six activity types, so an agent written for that model maps across one to one.
  - `PROMPT` is written by a person: the message that started the session, or an answer.
  - The other five are written by the agent.
  - An `ACTION` that queued a proposal names it (`proposalId`).
- **Append-only.** A trigger refuses `DELETE` and refuses `UPDATE`, except the key-rotation re-wrap of the encrypted body with every other column unchanged. The application role has no `DELETE` grant. This is the inflect-compliance pattern for write-once tables with encrypted columns. Pattern only.
- **The body is untrusted content.** It is sanitised to plain text, capped in size (recommended: 16 KB), scanned for secrets before it is stored, encrypted at rest through the manifest, and rendered as text, never as HTML. It is scanned for injection whenever it is given back to a model.
- Every entry and every tool call stamps the session's heartbeat.
- Entries appear in the item's Activity, marked as agent-written (H7).
- **Visibility risk.** Everyone who can see the item can see its activity. An agent acting with a person's wider access could quote, in a `THOUGHT`, content from a project that some viewers of this item cannot see. Recommendation: a session on an item reads only that item's project and the projects the workspace marks as shared, unless the owner decides otherwise. See open question 4.

### 7. Checkout: two agents never hold one item

- **A checkout is the live session itself.** A partial unique index allows at most one session per work item in `PENDING`, `ACTIVE` or `AWAITING_INPUT`. Two agents can never hold one item, and one agent cannot hold it twice.
- **Taking a checkout is one transaction:**
  1. a conditional update sets the delegate only if the item has no delegate or already has this agent, has an assignee, is not deleted, and is not closed;
  2. the session row is inserted.
  - If two requests race, the unique index refuses the second. The usecase maps that to 409, `ITEM_CHECKED_OUT`, naming the holder.
  - The conditional update alone cannot stop two first-time inserts; the index is the backstop. inflect-compliance uses the same conditional-claim shape for invite redemption and proposal decisions. Pattern only, no code copied.
- A live session's agent must equal the item's delegate. The usecase holds that, and a trigger backs it.
- Any terminal move releases the checkout, because the index covers live states only.
- **Invocations against an item:**
  - Delegation: as above.
  - Mention: if the item has no delegate, the mentioned agent becomes the delegate (when the person may delegate). If the same agent is the delegate, the mention joins its live session as a `PROMPT`, or starts a new session. If another agent holds the item, the mention is refused and names the holder.
  - Schedule and automation: the same rules. A scheduled session with no item, such as a digest, holds no checkout.
- Questions that change nothing go to the assistant, which needs no checkout.
- External agents check out through an MCP tool and must then heartbeat. Silence releases the item through `STALE`.

### 8. Proposals: what Phase 6 ports, and what changes

Roadmap 6.2 ports the proposal queue described in the Context. Islestone keeps its controls: schema validation and sanitisation at propose time, the output guard and quarantine, approval that runs the real usecase as the approver, encryption of payload and rationale, pinned policy-card version, required approvals and expiry, traceability to the run and step, and retrospective sampling.

Changes:

- **Names** (ADR 0006): the model is `Proposal`. Status is its own enum, `ProposalStatus`: `PENDING`, `APPROVED`, `APPROVED_WITH_EDITS`, `REJECTED`, `QUARANTINED`, `EXPIRED`. It does not reuse a suggestion enum.
- **Kinds** fit project management: work item create and update, comment, relation, plan (roadmap 7.1), schedule change (roadmap 7.5). The kind is text checked against a list in code, because new kinds will arrive often. inflect-compliance makes the same choice for `approvalRung` to avoid enum changes during rolling deploys (`agentic.prisma` lines 1292–1295).
- **Session link.** A proposal names its session. It appears in the session's activity as an `ACTION`, the session waits in `AWAITING_INPUT`, and the decision returns it to `ACTIVE`.
- **Stale updates.** An `UPDATE` proposal records the item's version and the values of the fields it changes (ADR 0002, section 9). Approval refuses it as stale only if one of those fields has changed since; otherwise it applies to the current version. A stale proposal shows the reviewer a fresh difference, and the agent may propose again.
- **Who approves.** By default the review request goes to the item's assignee. Any person whose own permission covers the real usecase may approve. One approval is the default; a policy card may require two.
- **Expiry.** An expired proposal is reported into its session as an activity entry. An engine run waiting on it fails, as in inflect-compliance.
- Proposals made through the assistant name the person who composed them and no agent.

### 9. The rung ladder

- **Decided (open question 9). Owner decision, 2026-11-18; the owner chose "Owners may raise rungs".** There is no rung cap. From Phase 6, a workspace owner may raise an agent's autonomy rung, within that agent's grants, as roadmap principle 2 allows. The draft had recommended shipping Phase 6 with a source constant that capped the ladder at `PROPOSE`; the owner decided against it.
- A workspace owner may raise one agent, for one tool the agent is granted, from `PROPOSE` to `AUTOMATIC`. The change is audited.
- At `AUTOMATIC`, the write still runs through the same usecase, under the authorising person's permissions, attributed to the agent and session, and under the kill switch, caps and budgets.
- In a session that someone other than the item's assignee started, the tool's writes still go to the assignee as proposals, at `AUTOMATIC` too (decisions 8 and 10, section 4). A session the assignee started follows the rung.

### 10. Kill switch

- Ported in roadmap 6.1 with its three scopes, history rows and uncached check before every model call and every tool call.
- **Islestone addition:** engaging a kill ends every live session in its scope (`ERROR`, reason `KILLED`) in the same transaction. That releases the checkouts at once, rather than at the agent's next call.
- Pending proposals from those sessions stay in the queue, as in inflect-compliance. The review page marks them "agent stopped", so a reviewer knows before approving.
- Lifting a kill restarts nothing. Work resumes only by a new invocation.
- An external agent's MCP calls and REST calls are refused while its kill is in force.

### 11. Budgets with hard stops

**Engine agents:**

- Every run is bounded by run caps: steps, tool calls, proposals, tokens and wall clock. They charge all or nothing, take the stricter of engine and policy card, and halt the run before its next model call (the inflect-compliance pattern).
- **Every agent has a monthly budget, and a project may have one.** The workspace's AI budget (H7, roadmap 8.1) applies as well. The effective limit is the smallest.
- **Reserve before the run.** At admission, the run's maximum cost (from its caps) is reserved with a conditional update that succeeds only if spent, plus reserved, plus this reservation stays within the limit. Two concurrent runs therefore cannot both pass on the same remainder; this applies inflect-compliance's reserve-before-the-call rule for its policy-card counter. At the end of the run, actual use is charged and the rest released.
- This differs from inflect-compliance, where a missing budget means unlimited. Roadmap 2.2 asks for a budget with a hard stop for every agent, so Islestone requires a finite budget per agent, with a default from the plan.

**External agents:**

- Their model spend is outside Islestone and cannot be budgeted here. They are bounded by action counts per session and per day (policy-card actions), reserved before each call.

**On a stop:**

- The session ends `ERROR`, reason `BUDGET_EXHAUSTED` or `CAP_REACHED`. No further model or tool call is made.
- The agent owner and the item's assignee are notified, with the limit and the amount used.
- Cost is recorded per run and per session, and shown (H6).

### 12. Schema sketch (illustrative, not final)

Relations, `@relation` lines and some timestamps are left out. Comments show composite foreign keys.

```prisma
enum AgentStatus        { DRAFT ACTIVE SUSPENDED RETIRED }
enum AgentKind          { ENGINE EXTERNAL }
enum AgentSessionStatus { PENDING ACTIVE AWAITING_INPUT COMPLETE ERROR STALE }
enum AgentInvocation    { DELEGATION MENTION SCHEDULE AUTOMATION }
enum AgentActivityType  { PROMPT THOUGHT ACTION ELICITATION RESPONSE ERROR }

// On WorkItem (ADR 0002), added in roadmap 6.3:
//   delegateAgentId String?   FK (delegateAgentId, tenantId) -> Agent(id, tenantId)
//   CHECK (delegateAgentId IS NULL OR assigneeId IS NOT NULL)
//   assigneeId is FK (tenantId, assigneeId) -> TenantMembership(tenantId, userId), RESTRICT

model Agent {
  id              String      @id @default(cuid())
  tenantId        String
  name            String
  kind            AgentKind
  status          AgentStatus @default(DRAFT)
  ownerUserId     String      // an active member when written; moves only by two-step transfer
  createdByUserId String
  createdAt       DateTime    @default(now())
  @@unique([id, tenantId])
  @@index([tenantId, status])
  @@index([tenantId, ownerUserId])
}

model AgentSession {
  id               String             @id @default(cuid())
  tenantId         String
  agentId          String             // FK (agentId, tenantId) -> Agent
  workItemId       String?            // FK (workItemId, tenantId) -> WorkItem; null for item-less work
  status           AgentSessionStatus @default(PENDING)
  invocation       AgentInvocation
  invokedByUserId  String?            // the authorising person (section 4)
  automationRuleId String?
  endReason        String?            // closed list, CHECKed per terminal status
  lastSeq          Int                @default(0)   // activity counter; also bumped as heartbeat
  lastHeartbeatAt  DateTime?
  createdAt        DateTime           @default(now())
  endedAt          DateTime?
  @@unique([id, tenantId])
  @@index([tenantId, workItemId, createdAt])
  @@index([tenantId, agentId, status])
  @@index([status, lastHeartbeatAt])  // the reaper's sweep across workspaces
  // partial unique (tenantId, workItemId) WHERE status IN ('PENDING','ACTIVE','AWAITING_INPUT')
  //   -- this index IS the checkout
  // CHECK (invocation = 'AUTOMATION') = (automationRuleId IS NOT NULL)
  // trigger: no move out of COMPLETE, ERROR or STALE; live agent = item delegate
}

model AgentActivity {
  id           String            @id @default(cuid())
  tenantId     String
  sessionId    String            // FK (sessionId, tenantId) -> AgentSession
  seq          Int
  type         AgentActivityType
  authorUserId String?           // set only for PROMPT
  body         String            // encrypted (manifest); sanitised plain text; capped
  proposalId   String?
  createdAt    DateTime          @default(now())
  @@unique([sessionId, seq])
  @@index([tenantId, sessionId, seq])
  // trigger: no DELETE; no UPDATE except the key-rotation re-wrap of body
  // CHECK (type = 'PROMPT') = (authorUserId IS NOT NULL)
}

model AgentBudget {
  id            String   @id @default(cuid())
  tenantId      String
  agentId       String?          // exactly one of agentId, projectId (CHECK)
  projectId     String?
  periodStart   DateTime @db.Date  // first day of the UTC month
  limitAmount   BigInt           // unit: open question 3
  reservedAmount BigInt  @default(0)
  spentAmount   BigInt   @default(0)
  @@unique([tenantId, agentId, periodStart])
  @@unique([tenantId, projectId, periodStart])
  // CHECK spentAmount + reservedAmount <= limitAmount
}

enum ProposalStatus { PENDING APPROVED APPROVED_WITH_EDITS REJECTED QUARANTINED EXPIRED }

model Proposal {                 // ported in roadmap 6.2; only the Islestone additions are shown
  id                String         @id @default(cuid())
  tenantId          String
  kind              String         // checked against a list in code
  operation         String         // CREATE | UPDATE, CHECKed
  status            ProposalStatus @default(PENDING)
  agentId           String?        // null when the assistant composed it for a person
  sessionId         String?        // FK (sessionId, tenantId) -> AgentSession
  composedByUserId  String?
  targetId          String?        // required for UPDATE (CHECK)
  baseVersion       Int?           // the target's version when proposed
  baseValues        String?        // encrypted: the changed fields' values when proposed
  payload           String         // encrypted
  @@index([tenantId, status, createdAt])
  @@index([tenantId, sessionId])
}
```

All tables follow roadmap section 4: `tenantId`, a tenant-leading index, RLS policies in the creating migration, and a two-tenant test. The two sweep indexes (`[status, lastHeartbeatAt]` here, and the proposal-expiry sweep) are the deliberate exceptions to tenant-leading, because the sweeps run across every workspace.

### Open questions for the owner

1. Keep the roadmap's six session states, with ending by a person recorded as `COMPLETE` plus a reason (recommended), or add `CANCELLED`, or Linear's `stopping`?
2. Who may delegate to an agent: anyone who can edit the item, or only holders of a separate permission in the roadmap 1.4 permission set? Recommendation: a separate permission.
3. Budget unit: money in minor currency units, from a versioned price table pinned per run (recommended, because tokens are not comparable across models), or tokens, as inflect-compliance does?
4. Agent read scope on an item session: limited to the item's project and workspace-shared projects (recommended), or the authorising person's full access?
5. How long may a session wait in `AWAITING_INPUT` before it ends? Recommendation: no automatic end in Phase 6; revisit with usage data.
6. Default stale bounds: 10 minutes for acknowledgement and 30 minutes for heartbeat (recommended), or other values?
7. This session's network refused `linear.app`. Allowing it would let the Linear agent guidelines be read and cited directly.
8. **Decided, 2026-11-18** (section 4): a session someone other than the assignee starts on an item runs at once, with the assignee notified and every write a proposal that goes to them. The owner chose "Run now, assignee notified".
9. **Decided, 2026-11-18** (section 9): no rung cap. Workspace owners may raise rungs from Phase 6, within the agent's grants, as roadmap principle 2 allows. The owner chose "Owners may raise rungs", against the draft's recommendation of a cap at `PROPOSE`.
10. **Decided, 2026-11-18** (sections 4 and 9). Raised by decisions 8 and 9 together: when a workspace owner has raised a tool to `AUTOMATIC`, does a session that someone other than the assignee started still send that tool's writes to the assignee as proposals, or write directly? Such a session never writes directly, whatever the rung: its writes go to the assignee as proposals, so decision 8 wins over decision 9 for it. Sessions the assignee started follow the rung. The owner chose "Proposals to assignee".

## Consequences

- Every delegated item has a named, accountable person. No item is ever "owned" by an agent.
- Agents never appear in seat counts, membership lists or sign-in tables. Code that lists "people" never meets an agent by accident.
- Most agent work produces proposals, so the review queue is the product's main agent surface. Its expiry and sampling controls matter from the first release of Phase 6.
- From Phase 6, a workspace owner can move an agent's tool to `AUTOMATIC` (section 9). Those writes skip the review queue, but keep the usecase, the authorising person's permissions, attribution to the agent and session, the kill switch, caps and budgets. The rung change is audited. A session someone other than the assignee started still sends its writes to the assignee as proposals, whatever the rung (open question 10, decided).
- A session a teammate starts on someone else's item runs at once (section 4). Its writes still reach that item only as proposals the assignee decides, and the assignee can end it.
- One live session per item serialises agents on an item. Parallel agent work on one piece of work means splitting it into sub-items.
- Changing the assignee ends the live session. A person taking over must restart the agent; in exchange, no session carries on into a new assignee's accountability without their choice.
- Removing a member ends every agent session on the items assigned to them and clears those items' delegates. Offboarding shows the person removing them which items that touches.
- Removing a member suspends the agents they own at once. Offboarding needs a transfer step for those agents.
- Required per-agent budgets mean a new agent cannot run until it has one. Plans must supply a default.
- External agents are bounded by action counts, not money. Their model cost stays with the customer.
- The session states match Linear's except `stopping`, and the activity types match Linear's six. Agents written for that model map across with little translation; Islestone's own `Agent` model does not match Linear's agents-as-users choice.
- ADR 0001 D1 allows copying inflect-compliance code, so Phase 6 can port the engine, queue and kill switch as code, each copied file with its `PROVENANCE.md` row. The patterns this ADR names were read, not copied; anything written fresh from them is recorded as pattern only.

## What would change this decision

- Customers need two agents on one item at once, for example a reviewer agent beside a builder agent. A second, read-only session class without a checkout would be the likely change.
- The owner wants an explicit `CANCELLED` or `STOPPING` state (open question 1).
- An external standard for agent sessions, such as an MCP extension or a Linear-compatible interface, fixes different states or activity types. Islestone would map at the adapter (ADR 0006, rule 5) before changing its own model.
- `AUTOMATIC` writes in use from Phase 6 show that raising a rung needs a cap or a stricter process. That would be a new owner decision.
- Paperclip's schema, once its licence is re-read and its commit pinned under H0, shows a better checkout or budget design.
- Linear's written guidelines, once readable, say something this ADR contradicts.
- The owner chooses a different visibility rule for agent activity (open question 4).

## References

- Roadmap (`docs/ROADMAP.md`):
  - 2.2 (Paperclip and Plane verdicts; idea 1: agents as delegates with sessions, activity, budgets and review gates);
  - 2.4 (build the delegate, session and activity model in-house; MCP elicitation);
  - 3, principles 1 and 2;
  - 4 (global preamble);
  - 1.4 (permission set and roles);
  - 6.1, 6.2, 6.3, 7.7, 8.1, 8.4;
  - H6 and H7.
- Islestone ADRs: `docs/adr/0001-code-provenance-and-licences.md` (D1 and the copy rule), `docs/adr/0002-work-item-model.md`, `docs/adr/0006-vocabulary.md`.
- `@linear/sdk` 103.0.0 (MIT, npm registry), `dist/index-BNMxzn7u.d.mts` lines 320–325, 335–342, 570–578, 6971 and 7018–7019.
- inflect-compliance, read-only, at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`:
  - `prisma/schema/agentic.prisma` (lines 5–265, 740–800, 1235–1354, 1772–1861, 3202–3215);
  - `prisma/schema/enums.prisma` (lines 868–885, 2091–2099);
  - `src/app-layer/usecases/agent-proposals.ts` (lines 1–18, 929, 1656, 2280, 2407);
  - `src/lib/agentic/kill-switch.ts` (lines 1–80);
  - `src/lib/agentic/run-caps.ts` (header);
  - `src/lib/agentic/monthly-budget.ts` (lines 1–47);
  - `src/app-layer/jobs/agent-run-reaper.ts` (lines 1–50);
  - `src/app-layer/context-system.ts` (line 346);
  - `src/app-layer/usecases/agent-retirement-cascade.ts`, `agent-ownership-transfer.ts`, `agent-owner-orphan-pass.ts` (existence checked);
  - `docs/implementation-notes/2026-08-12-automation-actor-authority.md` (lines 1–30);
  - `CLAUDE.md` (#4196 kill before every model call; #4481 agent-bound keys at REST; "A2A messaging" re-wrap exception).
- Patterns reused from inflect-compliance, all pattern only, no code copied: agent separate from user with a required owner; two-step ownership transfer; the proposal queue's controls; the three-scope kill switch checked before every model and tool call; versioned policy cards; all-or-nothing run caps; pre-run budget check and reserve-before-use; the reaper that leaves human waits alone; re-reading a named person's authority when work runs; write-once triggers that admit the encryption re-wrap.
