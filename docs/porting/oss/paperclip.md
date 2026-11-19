# paperclip study

Read on 2026-11-18 for Islestone roadmap 6.3 (agents as delegates), 3.2 (goals and ancestry) and ADR 0003 (assignee and delegate). Nothing in the clone was built, installed or executed; only files were read. Line numbers are at the pinned commit.

## 1. Pin and licence facts

### As given by the workflow

- Clone: `/tmp/claude-0/-home-user/0c23d429-765a-50a1-803a-34c6b03926ac/scratchpad/oss-pins/paperclip/repo`
- Commit: `8285a81280db17898f38827a9f3c90221a82f23c` (2026-11-18 10:40:31 -0800, "fix(native): retry a fresh launch whose provider pack could not be verified (#22106)")
- Licence: MIT at the root and in all 41 workspace packages that declare a licence. Third-party subtrees use MIT, BSD-3-Clause, Apache-2.0, OFL-1.1 and Bitstream-Vera. All are permissive; none is copyleft or commercial. There are no `ee/`, `enterprise/`, `commercial/`, `premium/` or `proprietary/` directories, no `.gitmodules` and no SPDX headers.
- Subtrees under a different licence or holder: `docker/` (Tailscale, BSD-3-Clause); `tests/runner-e2e/` (OTLP-derived `eval-otlp-schema.ts`, Apache-2.0); `ui/public/fonts/` and `packages/paperclip-runner/devtools/issue-thread/src/fonts/` (OFL-1.1, Bitstream Vera); `ui/public/brands/` (LobeHub MIT icons of third-party trademarks); `packages/adapters/hermes/` (MIT, Nous Research); `packages/shared/src/cliplab/` (MIT, bloub/Cliplab); `skills/complain/` and `skills/suggestion-box/` (MIT, Denver Technologies); `.agents/skills/{create,maintain}-verification-skill/` and `.agents/skills/test-audit/` (MIT, Lauren Tan and OpenClaw Foundation).

### Verified in this session

- Remote: `https://github.com/paperclipai/paperclip`. The clone is blobless but **not shallow**: 8,261 commits, so history is readable.
- Root `LICENSE` (21 lines): "MIT License / Copyright (c) 2025 Paperclip AI", standard MIT text.
- **The LICENSE file was added late, and by an outside contributor.** It arrived in commit `59a07324e` ("Add License", 2026-03-07, authored by Ikko Ashimine, GitHub `eltociear`), merged through PR #151 (merge commit `63afce369`, 2026-03-07, merged by the maintainer Dotta, author of 513 of the 560 commits before it). So the copyright line "2025 Paperclip AI" was typed by the contributor; the maintainer's merge is the act that adopted it. The file has not changed since (blob `a63594a5`, identical at the pin and at the remote tip `33fac97` on 2026-11-18). The first commit is `481b3a46d` (2026-02-16). **597 commits in the pin's history have no root LICENSE in their tree**: the 560 on `master` before the merge, plus 37 on branches forked before it and merged later; the newest is `db15dfaf5` (2026-03-07 15:15 -0600). `server/package.json` declared no licence when it was created (`c9d7cbfe4`) or when the LICENSE arrived; `server`, `packages/db` and `packages/shared` first declare `"license": "MIT"` on 2026-03-17 (`6ba9aea8ba`, `0036f0e9a`). **Rule for Islestone: take nothing from a revision that does not have `63afce369` as an ancestor** (a date cut-off is not enough, because of the 37 late-merged branch commits). The pinned commit has it as an ancestor, and everything below is read there.
- `server/package.json`, `packages/db/package.json` and `packages/shared/package.json` each declare `"license": "MIT"`. The root `package.json` is `"private": true` with no licence field. Of the 51 `package.json` files at the pin, 41 declare MIT and 10 declare nothing: the root and nine examples, script helpers and test fixtures, all covered by the root LICENSE. No manifest declares any other licence.
- **The README names a different holder.** Its "License" section reads "MIT © 2026 Paperclip Labs, Inc" (linking paperclip.ing), while the LICENSE file says "Copyright (c) 2025 Paperclip AI". MIT asks for "the above copyright notice", i.e. the LICENSE file's line, so attribution reproduces that line verbatim (section 8 does); a NOTICE may add that the README names Paperclip Labs, Inc. as the holder.
- Third-party licence files at the pin, read one by one (all permissive): `docker/tailscale.LICENSE` (BSD-3-Clause, Tailscale Inc); `tests/runner-e2e/OTLP-LICENSE.txt` with `OTLP-NOTICE.md` (Apache-2.0, OpenTelemetry Authors, for `eval-otlp-schema.ts`); `ui/public/fonts/NOTICE.md` (Inter, OFL-1.1) and `ui/public/fonts/PaperMono-OFL.txt` (OFL-1.1, Paper-Mono authors); `packages/paperclip-runner/devtools/issue-thread/src/fonts/NOTICE.md` (Inter OFL-1.1, DejaVu/Bitstream Vera); `ui/public/brands/adapters/LICENSE` and `ui/public/brands/apps/LOBE-LICENSE` (MIT, LobeHub); `packages/adapters/hermes/LICENSE` (MIT, Nous Research); `packages/shared/src/cliplab/LICENSE` (MIT, Jérémy Perret and Tonio); `skills/{complain,suggestion-box}/LICENSE` (MIT, Denver Technologies, Inc.); `.agents/skills/{create,maintain}-verification-skill/NOTICE.md` (MIT, Lauren Tan) and `.agents/skills/test-audit/NOTICE.md` (MIT, OpenClaw Foundation). One extra, outside this study's scope: `server/src/__tests__/fixtures/otlp-observability.proto` is also an OTLP-derived field subset and carries no notice of its own. A full-tree search found no SPDX header and no AGPL, GPL, LGPL, BSL, Commons Clause, Elastic, SSPL or Sustainable Use text, and no `ee/`-style directory or `.gitmodules`.
- None of the files studied below carries a per-file copyright or SPDX header, so the root MIT notice covers them.
- Two licence files not in the given list, both MIT and both outside this study's scope: `tests/runner-e2e/fixtures/accessibility-source/LICENSE.md` (Copyright (c) 2026 conesible.de) and `packages/teams-catalog/catalog/optional/communications/speko-company-phone-agent/LICENSE` (Copyright (c) 2025 Paperclip AI).
- **There is no row-level security.** No migration among the 497 SQL files in `packages/db/src/migrations/` (498 entries counting the `meta/` folder) contains `ROW LEVEL SECURITY` or `CREATE POLICY`. Tenancy is a `company_id` column filtered in application code. Every table Islestone builds from this needs RLS added from scratch (roadmap principle 5).

### Not verified

- Whether "Paperclip AI" (the LICENSE) or "Paperclip Labs, Inc" (the README) is a registered legal entity, and whether contributors sign a CLA. The repository holds no CLA or DCO file or text, so none is evidenced. Neither changes MIT's terms for the code; both matter only if Islestone ever wants a separate grant.
- GitHub's own licence detection and the repository's owner type: the GitHub API is not reachable from this session.
- Trademark: MIT grants nothing on the name "Paperclip" or its logos. Islestone must not use either.

## 2. How to read Paperclip against Islestone

Paperclip runs "a company of AI agents". In Paperclip **an agent is the assignee** (`issues.assigneeAgentId`, exclusive with `assigneeUserId`), agents report to other agents, and humans are "the board" that approves hires and budget overrides. Islestone's model is the opposite (ADR 0003): a person is the assignee, an agent is at most a delegate, and agents write only through proposals. So **port the mechanisms, not the product model**: the checkout mutex, stale-lock recovery, the wake queue, budget reservation and hard stops, incident-linked approvals, cycle-safe tree walks and goal fallback.

The production code has grown far past its core. `server/src/services/issues.ts` is 14,998 lines and `server/src/services/heartbeat/queue.ts` 5,914; most of it handles native runners, chat, case handoffs and recovery paths Islestone does not have. Islestone should re-implement the core algorithms described in section 5 in its own usecase layer, not copy files.

## 3. Files worth porting from (paths, line counts, key ranges)

### Schema (Drizzle, `packages/db/src/schema/`)

| File | Lines | What it holds |
|---|---|---|
| `agents.ts` | 63 | Agent row, `reportsTo` org-chart FK, monthly budget columns, status, heartbeat time |
| `goals.ts` | 29 | Goal tree (`parentId`, `level`, `status`, `ownerAgentId`) |
| `project_goals.ts` | 21 | Project ↔ goal many-to-many |
| `projects.ts` | 49 | `goalId`, `leadAgentId`, `pauseReason` / `pausedAt` (budget pause) |
| `issues.ts` | 225 | Work item, including the lock columns `checkoutRunId`, `executionRunId`, `executionAgentNameKey`, `executionLockedAt`, plus `parentId`, `goalId` |
| `heartbeat_runs.ts` | 303 | Run row (status, scope, wake link, usage, liveness, retry chain) |
| `heartbeat_run_events.ts` | 65 | Append-only per-run event stream numbered by `seq` |
| `agent_wakeup_requests.ts` | 118 | The durable wake queue (source, status, coalescing, idempotency) |
| `agent_task_sessions.ts` | 93 | Per-(agent, adapter, task) resumable session parameters |
| `agent_runtime_state.ts` | 28 | Per-agent running totals (tokens, cost, last run) |
| `budget_policies.ts` | 50 | Budget policy per scope × metric × window |
| `budget_incidents.ts` | 42 | Soft and hard threshold crossings, linked to an approval |
| `accounting.ts` lines 52–78 | 131 total | `budget_reservations`: a hold per run, unique per run |
| `budget_resume_claims.ts` | 32 | A cancelled run owed one continuation after "raise and resume" |
| `cost_events.ts` | 74 | Append-only cost ledger per provider call |
| `approvals.ts` | 30 | Generic approval gate |
| `issue_approvals.ts` | 23 | Approval ↔ issue links |
| `execution_admissions.ts` | 65 | Project max-concurrent-tasks policy and per-run admission charges |
| `agent_api_keys.ts` | 24 | Hashed key per agent, revocable, with `responsibleUserId` |
| `activity_log.ts` | 52 | Activity trail (actor type and id, entity, run, details) |
| `companies.ts` | 48 | Tenant row with its own budget and pause columns |

### Services and domain logic

| File | Lines | Ranges worth reading |
|---|---|---|
| `server/src/services/issues.ts` | 14,998 | `sameRunLock` 2192–2195; `TERMINAL_HEARTBEAT_RUN_STATUSES` 2197–2203; `adoptStaleCheckoutRun` 8081–8197; `adoptUnownedCheckoutRun` 8199–8249; `clearExecutionRunIfTerminal` 8251–8298; `clearCheckoutRunIfTerminal` 8300–8379; `checkout` 12799–13094; `assertCheckoutOwner` 13096–13248; `release` 13249–13325; `adminForceRelease` 13326–13389; `getAncestors` 14760–14965; child-issue goal inheritance near 10150; create-time goal resolution near 11175 |
| `server/src/services/issue-goal-fallback.ts` | 56 | Whole file: goal fallback on create and on project move |
| `server/src/services/goals.ts` | 111 | Default company goal; same-company parent check |
| `server/src/services/agents.ts` | 295 | `orgForCompany` 217–237; `getChainOfCommand` 240–253 |
| `server/src/lib/agent-records.ts` | 491 | `ensureManager` 428–435; `assertNoCycle` 437–447 |
| `server/src/lib/agent-reporting-chain.ts` | 22 | Recursive CTE for the reporting chain |
| `packages/shared/src/agent-eligibility.ts` | 270 | `getAgentOrgChainHealth` 126–221; `getAgentWorkEligibility` 223–256 |
| `server/src/services/agent-invokability.ts` | 154 | Block reasons; descendants invalidated by a terminated manager |
| `server/src/modules/agent-lifecycle/domain/policy.ts` | 67 | Pure lifecycle state machine (pending_approval, preparing, verifying, ready, pausing, paused, resuming, terminating, cleaning_up, terminated, rejected) |
| `server/src/services/budgets.ts` | 1,405 | Windows 78–94; status 96–105; `budgetPoliciesForRun` 206–212; `readAdmissionScopes` 222–232; `scopePauseBlock` 234–242; `hardStopReached` 256–259; pause / cancel / resume 357–470; `createIncidentIfNeeded` 531–601; `reconcileScope` 695–727; `evaluateAffectedScopes` 729–803; `evaluateAdmissionInTransaction` 805–835; `resolveIncident` 1020–1150 |
| `server/src/services/budget-reservations.ts` | 171 | `recheckRunBudgetReservationInTransaction` 31–78; `reserveRunBudget` 92–171 |
| `server/src/services/budget-admission-controls.ts` | 16 | Shared locks on company and project before admission |
| `server/src/services/accounting-transaction.ts` | 126 | Retrying transaction wrapper (8 attempts, 10–400 ms backoff) |
| `server/src/services/budget-exposure.ts` | 215 | Spend = ledger + held reservations + live estimates |
| `server/src/services/approvals.ts` | 207 | Approval lifecycle (cancel, request revision, resubmit, decide) |
| `server/src/lib/approval-records.ts` | 72 | Idempotent conditional resolve |
| `server/src/modules/wake-queue/domain/policy.ts` | 435 | Pure wake decisions; `decideWakeAdmission` 47–63 |
| `server/src/services/heartbeat/queue.ts` | 5,914 | `enqueueWakeup` from 2777; budget gate 3396; issue row lock 3532; agent row lock and daily cap 5410–5440 |
| `server/src/services/heartbeat/timer-policy.ts` | 264 | `parseHeartbeatPolicy` 54–84 |
| `server/src/modules/active-run-watchdog/domain/policy.ts` | 91 | Silence classification |
| `server/src/services/recovery/service.ts` | 6,998 | Silence thresholds, lines 241–242 |

### Design documents

| File | Lines | Use |
|---|---|---|
| `doc/spec/agent-runs.md` | 773 | §8 (347–421), the wakeup coordinator spec; §12.4 restart recovery (675–683) |
| `docs/guides/agent-developer/heartbeat-protocol.md` | 128 | The agent-side protocol: identity, assignments, checkout, "never retry a 409" |
| `docs/api/issues.md` | 473 | Checkout API, from line 167 |
| `docs/start/core-concepts.md` | 86 | The product model in one page |
| `doc/GOAL.md` | 58 | The control-plane framing |
| `server/src/modules/README.md` | 113 | The domain / application / adapters layer rule |

## 4. Data model (compact transcription)

Notation: `col type [default] → FK`. Every table carries `companyId → companies` (the tenant). Statuses are `text` columns validated against TypeScript constant arrays, not Postgres enums.

```
companies   id, name, status[active]|paused, pauseReason, pausedAt,
            budgetMonthlyCents int[0], spendMonthUtc text, spentMonthlyCents numeric(24,7),
            budgetOwnerUserId, defaultDecisionOwnerUserId, requireBoardApprovalForNewAgents bool

agents      id, companyId, name, role[general], title, capabilities text,
            status[idle] ∈ {active,paused,idle,running,error,pending_approval,terminated},
            lifecycleState[ready], lifecycleVersion int, lifecycleHolds jsonb[],
            reportsTo → agents.id (self; the org chart),
            adapterType, adapterConfig jsonb, runtimeConfig jsonb (holds heartbeat policy),
            budgetMonthlyCents int[0], spentMonthlyCents numeric(24,7), spendMonthUtc,
            pauseReason, pausedAt, permissions jsonb, lastHeartbeatAt, createdByUserId
            unique(companyId,id); idx(companyId,status); idx(companyId,reportsTo)

goals       id, companyId, title, description,
            level[task] ∈ {company,team,agent,task},
            status[planned] ∈ {planned,active,achieved,cancelled},
            parentId → goals.id (self), ownerAgentId → agents
            idx(companyId)
projects    …, goalId → goals, leadAgentId → agents, status, pauseReason, pausedAt
project_goals  PK(projectId,goalId), companyId          -- many-to-many, beside projects.goalId

issues      id, companyId, projectId, goalId → goals, parentId → issues (self),
            title, description, priority[medium],
            status[backlog] ∈ {backlog,todo,in_progress,in_review,done,blocked,cancelled},
            assigneeAgentId → agents, assigneeUserId text,
            checkoutRunId  → heartbeat_runs ON DELETE SET NULL   -- ownership claim
            executionRunId → heartbeat_runs ON DELETE SET NULL   -- workspace execution lock
            executionAgentNameKey text, executionLockedAt timestamptz,
            createdByAgentId, createdByUserId, responsibleUserId,
            startedAt, completedAt, cancelledAt, hiddenAt, statusVersion bigint
            unique(companyId,id); idx(companyId,assigneeAgentId,status); idx(companyId,parentId)

heartbeat_runs
            id, companyId, agentId, scopeKind[company]|issue, issueId → issues SET NULL,
            invocationSource[on_demand], triggerDetail,
            status[queued] ∈ {queued,scheduled_retry,running,succeeded,interrupted,failed,cancelled,timed_out},
            wakeupRequestId → agent_wakeup_requests, responsibleUserId,
            startedAt, finishedAt, error, errorCode, exitCode,
            usageJson, resultJson, contextSnapshot jsonb,
            costAccountingPending bool, costAccountedAt,
            lastOutputAt, lastOutputSeq, livenessState, nextEventSeq bigint,
            retryOfRunId → heartbeat_runs, scheduledRetryAt, scheduledRetryAttempt
            CHECK scopeKind='company' ⇒ issueId IS NULL
            terminal = {succeeded,interrupted,failed,cancelled,timed_out}

heartbeat_run_events  companyId, runId, agentId, seq bigint, eventType, stream, level,
                      message, payload, createdAt            -- append-only, ordered by seq

agent_wakeup_requests
            id, companyId, agentId, source ∈ {timer,assignment,on_demand,automation},
            triggerDetail ∈ {manual,ping,callback,system}, reason, payload jsonb,
            status[queued] ∈ {queued,deferred_issue_execution,claimed,coalesced,skipped,completed,failed,cancelled},
            coalescedCount int[0], requestedByActorType, requestedByActorId,
            idempotencyKey, runId, requestedAt, claimedAt, finishedAt, error
            partial unique(companyId,idempotencyKey) per key prefix (task-retry:, chat-completion:, …)
            idx(companyId,agentId,status); idx(companyId,requestedAt)

agent_task_sessions  companyId, agentId, adapterType, taskKey, sessionParamsJson, lastRunId, lastError
                     unique(companyId,agentId,adapterType,taskKey)

budget_policies
            id, companyId, scopeType ∈ {company,agent,project}, scopeId uuid,
            metric[billed_cents], windowKind ∈ {calendar_month_utc,lifetime},
            amount int[0], reservationCents numeric(24,7)[0], warnPercent int[80],
            hardStopEnabled bool[true], unpricedUsagePolicy[block]|allow, notifyEnabled, isActive,
            enforcementVersion, enforcementDeliveredVersion, evaluationVersion
            unique(companyId,scopeType,scopeId,metric,windowKind); CHECK reservationCents ≥ 0
            default window: project → lifetime, company and agent → calendar_month_utc

budget_reservations
            id, companyId, runId → heartbeat_runs, agentId, projectId,
            amountCents numeric(24,7), state[held] ∈ {held,settled,released},
            providerStartedAt, settledAt
            unique(companyId,runId)                  -- one hold per run; also fences duplicate dispatch
            partial idx(companyId,agentId,projectId) WHERE state='held'
            CHECK exactly one source id set; CHECK amountCents ≥ 0

budget_incidents
            id, companyId, policyId → budget_policies, scopeType, scopeId, metric, windowKind,
            windowStart, windowEnd, thresholdType ∈ {soft,hard}, amountLimit, amountObserved numeric,
            status[open] ∈ {open,resolved,dismissed}, approvalId → approvals, resolvedAt
            partial unique(policyId,windowStart,thresholdType) WHERE status='open'

budget_resume_claims  runId PK, companyId, incidentId, actorUserId, state[pending], claimedAt, settledAt

cost_events id, companyId, agentId, issueId, projectId, goalId, heartbeatRunId,
            provider, biller, billingType, costStatus, model,
            inputTokens, cachedInputTokens, outputTokens, costCents numeric(24,7),
            idempotencyKey, pricingProvenance jsonb, occurredAt
            unique(companyId,idempotencyKey); CHECK all amounts ≥ 0

approvals   id, companyId,
            type ∈ {hire_agent,approve_ceo_strategy,budget_override_required,request_board_approval},
            requestedByAgentId, requestedByUserId,
            status[pending] ∈ {pending,revision_requested,approved,rejected,cancelled},
            payload jsonb, decisionNote, decidedByUserId, decidedAt
issue_approvals  PK(issueId,approvalId), linkedByAgentId, linkedByUserId

project_task_execution_policies  projectId PK, maxConcurrentTasks int NULL(=unlimited) CHECK > 0
execution_admissions  id, runId, attempt, admittedProjectIds uuid[], settledAt
                      partial unique(runId) WHERE settledAt IS NULL

agent_api_keys  id, agentId, companyId, name, keyHash, responsibleUserId, scopeConfig jsonb,
                lastUsedAt, revokedAt
```

Relations that matter: `issues.checkoutRunId` and `issues.executionRunId` point at runs, not at agents, so a lock always names one specific run. `heartbeat_runs.wakeupRequestId` ties a run to the wake that caused it, and `agent_wakeup_requests.runId` ties a coalesced wake to the run that absorbed it. `budget_incidents.approvalId` ties a hard stop to the human decision that can lift it.

## 5. Algorithms (prose and pseudo-code; no code copied)

### 5.1 Atomic checkout and the execution lock

Two lock columns on the issue row:

- `checkoutRunId`: which run of the assignee agent owns the work. Set by checkout.
- `executionRunId`: which run holds the issue's workspace. Set by checkout and by wake admission. A mention wake for a second agent must respect it.

The mutex is the issue row itself. A conditional `UPDATE … WHERE <lock is free or mine>` cannot succeed twice: Postgres takes a row lock, a concurrent update waits, and under READ COMMITTED the waiter re-evaluates the `WHERE` against the committed row, finds the lock taken, and updates nothing. No partial unique index is needed for the claim itself.

```
sameRunLock(held, mine):  mine present → held = mine;   mine absent → held is null

checkout(issue, agent, expectedStatuses, myRun):
  require issue exists; require agent assignable (status and org-chain health, 5.7)
  refuse 409 if an active subtree pause covers the issue
  lazily clear executionRunId if it names a terminal or missing run      (own tx, rows locked)
  lazily clear checkoutRunId  if it names a terminal or missing run      (own tx, rows locked)
  refuse 422 if the issue has unresolved blockers (list them)
  tx: UPDATE issue SET assigneeAgent=agent, assigneeUser=null,
                       checkoutRun=myRun, executionRun=myRun, status=in_progress, startedAt=now
      WHERE status ∈ expectedStatuses
        AND (assigneeAgent IS NULL OR (assigneeAgent=agent AND checkoutRun ∈ {null, myRun}))
        AND executionRun ∈ {null, myRun}
      RETURNING row
  if a row came back: success
  read the current row, then try in order:
    a. adopt unowned: mine in_progress, no checkout run, execution run null or mine → conditional set
    b. adopt stale checkout: same agent, another run holds it → lock issue and both runs FOR UPDATE;
       if the held run is terminal or missing and myRun is live → conditional swap to myRun
    c. adopt stale execution lock: assignee mine or null, execution run terminal or missing → conditional set
    d. idempotent: same agent, in_progress, sameRunLock → return the row (never self-409)
    e. otherwise 409 "checkout conflict" naming status, assignee, checkoutRun, executionRun
```

Client contract (heartbeat protocol): send the run id in a header; a 409 means "someone else owns it, pick other work"; **never retry a 409**. To re-claim after a crash, include `in_progress` in `expectedStatuses`.

`assertCheckoutOwner` runs before every mutating call from an agent: lazily clear terminal locks, then accept only same agent, `in_progress` and `sameRunLock`, adopting an unowned lock for a live run where allowed.

### 5.2 Release

```
release(issue, actorAgent?, actorRun?):
  lock issue FOR UPDATE
  if actorAgent given and the assignee is another agent → 409 "only assignee can release"
  if in_progress, held by another run of the same agent:
     allowed only if that run is terminal or missing; else 409 "only checkout run can release"
  status: in_progress → todo; any other status is kept
  assignee: cleared, except on done/cancelled, where it stays as the record of who did the work
  clear checkoutRun, executionRun, executionAgentNameKey, executionLockedAt

adminForceRelease(issue, clearAssignee?):  lock; clear the four lock columns; optionally the assignee
```

Stale locks are cleared **lazily** at the next checkout or ownership check, under row locks, whenever the named run is terminal (succeeded, interrupted, failed, cancelled, timed_out) or deleted. A watchdog flags running runs by output silence: "suspicious" at 5 minutes and "critical" at 15 minutes since the last output, falling back to process start, run start, then creation time.

### 5.3 Heartbeat wake queue

Agents do not run continuously; they wake in heartbeats. Every trigger calls one function, and nothing else starts an adapter. The queue is the `agent_wakeup_requests` table, so it survives restarts.

```
enqueueWakeup(agent, {source, triggerDetail, reason, payload, requestedBy, idempotencyKey, issueId?}):
  strip internal authority markers from the caller's payload; a manual wake needs an authenticated user
  an idempotency key reused with different input → 409
  company not active → 409
  budget invocation block (company, agent and project scopes; 5.5) →
      write a wake row status=skipped with the reason, then 409 (or save the message as deferred)
  agent not invokable (status or org chain, 5.7) → refuse with a named reason
  if issue-scoped:
    tx: SELECT issue FOR UPDATE                          -- serialises every admission for the issue
        find the live run holding executionRun
        decide: same agent, live run, coalescing allowed → COALESCE: merge the context into that run,
                                                           insert a wake row status=coalesced, runId=it
                another live run                         → DEFER: insert status=deferred_issue_execution,
                                                           or bump coalescedCount on the existing one
                none                                     → PROCEED
  PROCEED: tx: SELECT agent FOR UPDATE
               daily cap (maxDailyRuns or maxDailyCostCents in the current UTC day) → wake row skipped
               insert heartbeat_run status=queued and a wake row linked to it
dispatch: per agent at most maxConcurrentRuns (default 20; 1 for some runners)
          FIFO by requestedAt; spec priority on_demand > assignment > timer/automation
on run finish: release the issue's execution lock, then promote the earliest deferred wake for it
```

Two habits worth copying: **every refused wake is a row** (`skipped` with a reason), never a silent drop; and the decisions live in pure functions (`decideWakeAdmission`, `decidePreDrain`, `decideWakeOutcome`) that take a facts object, while the adapter reads the database. The per-agent heartbeat policy sits in `agents.runtimeConfig.heartbeat`: `enabled`, `intervalSec`, `wakeOnDemand`, `maxConcurrentRuns`, `skipTimerWhenNoActionableWork`, `maxDailyRuns`, `maxDailyCostCents`.

### 5.4 Runs

A run is one heartbeat of one agent, scoped to the company or to one issue. Its status moves from `queued` (or `scheduled_retry`) to `running`, then to one of five terminal states. Its events are an append-only stream numbered by `seq` per run. Retries chain through `retryOfRunId`. Accounting is a separate, retried step (`costAccountingPending`, `costAccountedAt`), so a run can finish before its cost is final. Spec §12.4 restart recovery: on startup, stale `queued` and `running` runs are failed with `control_plane_restart`.

### 5.5 Budgets: scopes, reservation, hard stop

Scopes are company, agent and project. A run is admitted only if **every** active policy that applies to it admits it, so the tightest scope wins. Windows are the calendar UTC month or lifetime. Metric is billed cents, held as `numeric(24,7)` so fractional cents survive.

```
observed(policy) = ledger sum in window (cost_events)
                 + held reservations + live estimates of unfinished runs      (budget-exposure.ts)
hardStopReached(policy) = active AND hardStopEnabled AND amount > 0
                          AND (observed ≥ amount OR (unpricedUsagePolicy=block AND unpriced usage exists))
softThreshold = ceil(amount × warnPercent / 100)

admission(run):                                    -- READ COMMITTED; retried on serialization errors
  share-lock company and project rows; share-lock agent row; lock run row FOR UPDATE
  refuse if the run was cancelled, already accounted, or is no longer queued or running
  one reservation per run (unique index): a second dispatch → 409
  for each scope: an explicit pause → block; any hardStopReached → block
  agent lifecycle not ready, or paused → block
  estimate = max(policy.reservationCents) over the applicable policies
  for each policy: committed = ledger + held
                   refuse if committed ≥ limit OR committed + estimate > limit
  insert reservation(state=held, amount=estimate); mark the run costAccountingPending
  queue a budget evaluation for the scopes
  recheck the same at the final dispatch gate, just before provider work starts

evaluateAffectedScopes (after each charge):
  crossing softThreshold → open a soft incident once per (policy, window, soft); log activity
  hardStopReached → resolve soft incidents; open a hard incident once per window,
     with a pending approval of type budget_override_required;
     pause the scope (agent hold; project paused; company paused) with pauseReason=budget;
     bump enforcementVersion so the enforcement worker cancels running work in the scope
  scopes back under every limit → release only budget-owned pauses (manual pauses stay)

resolveIncident(action):
  keep_paused → leave it
  raise_budget_and_resume → new amount must exceed observed spend, and unpriced usage must be
     resolved or allowed; raise the policy; resume the scope; give each run the stop cancelled
     one continuation (budget_resume_claims); close the incident
monthly rollover: a reconcile job releases budget-owned holds when a new window opens
```

Paperclip states the limitation itself: estimates constrain admission but cannot cap a provider's bill ("Estimates constrain admission; they cannot cap a provider's bill"). Running work is stopped asynchronously by the enforcement worker, so a run can overshoot. `amount = 0` means no limit.

### 5.6 Approval gate

`approvals` is one generic table with a JSON payload. States: `pending` → `approved` | `rejected` | `cancelled`; `pending` → `revision_requested` → (resubmit with a new payload) → `pending`. Resolution is a conditional update `WHERE status IN (pending, revision_requested)`. If the row is already in the target state, the call returns `applied: false` instead of failing, so a double click is harmless. Any other state is a 422. `hire_agent` routes into the lifecycle machine (`pending_approval` → `preparing`, or `rejected`). `budget_override_required` is created with each hard incident. `issue_approvals` links approvals to issues, and resolving one wakes the requesting agent with the approval id.

### 5.7 Org chart and chain health

```
on write of reportsTo: manager exists and is in the same company; not self;
                       walk up from the new manager; reaching the agent → "would create cycle"
readReportingChain:    recursive CTE up reportsTo, company-scoped; UNION removes duplicates, so a cycle ends
chainHealth(agent, chain):
  walk up with a seen-set:   revisit → invalid (cycle)
                             missing or other company → invalid (missing manager)
                             terminated ancestor → invalid
                             paused ancestor → warning only ("escalations route to a paused agent")
  invokable  = status ∈ {active, idle, running, error} AND chain healthy
  assignable = status ∈ {active, paused, idle, running, error} AND chain healthy
on terminating a manager: every non-terminated descendant becomes invalid, and its runs are cancelled
getChainOfCommand: walk up with a visited set, at most 50 levels
orgForCompany: group non-terminated agents by manager; an unknown manager is treated as root
```

### 5.8 Goal ancestry and goal fallback

```
goal on create:   explicit goalId → else, if the issue has a project → the project's goalId (may be null)
                  → else the company default goal
company default goal: the earliest active root goal at level company; else any root company goal;
                  else any company-level goal
subtask:          inherits the parent's goalId unless given one
on project move:  keep an explicit goal; if the current goal was only the old fallback,
                  recompute the fallback for the new project
goal parent:      must exist in the same company (FOR KEY SHARE); no cycle check on goal.parentId
getAncestors(issue):
  recursive CTE up issues.parentId, depth ≤ 50, carrying a path array; stop on a repeat
  order by depth; then batch-load the referenced projects and goals (no N+1)
```

What Paperclip does **not** do here: it does not walk the goal tree in `getAncestors` (it returns each ancestor's one goal), has no cycle check on `goals.parentId`, and computes no goal progress roll-up. A search of `server/src` and `packages/shared/src` for goal progress terms found nothing.

## 6. Mapping onto Islestone

| Paperclip mechanism | Islestone target | Verdict |
|---|---|---|
| Conditional-UPDATE checkout on the issue row (5.1) | ADR 0003 §7; roadmap 6.3 | **Adapt.** ADR 0003 makes the live `AgentSession` the checkout, backed by a partial unique index. Paperclip shows a second, cheaper mutex: a lock pointer on the work item. Recommend both: `WorkItem.liveSessionId` set by `UPDATE … WHERE liveSessionId IS NULL OR liveSessionId = :mine` (the claim), plus the partial unique index on live sessions (the backstop). This is the "better checkout design" case ADR 0003 lists under "What would change this decision"; it adds a column and changes no rule. |
| Checkout sets `assigneeAgentId`, nulls `assigneeUserId` | ADR 0003 §1–2 | **Reject.** In Islestone the person stays the assignee; checkout writes `delegateAgentId` under `CHECK (delegateAgentId IS NULL OR assigneeId IS NOT NULL)`. |
| Idempotent re-checkout by the same run; 409 naming the holder; "never retry a 409" | ADR 0003 §7 (`ITEM_CHECKED_OUT`); 7.7 external agents | **Take.** Put "never retry a 409" in the MCP tool description for external agents. |
| Lazy clearing of a lock whose run is terminal, at the next checkout | ADR 0003 §5 (reaper, `STALE`) | **Take as a second line.** The reaper stays primary; checkout also ends a live session whose heartbeat is past the stale bound, in the same transaction, before claiming. |
| Adopting a stale checkout by the same agent's new live run | ADR 0003 §5 ("a new invocation creates a new session") | **Adapt.** No resurrection: the old session ends `STALE`, a new session is created. Same outcome, and the audit trail stays clean. |
| `executionRunId` and deferring a second agent's wake | ADR 0003 §7 (a mention of another agent is refused) | **Open question for the owner:** refuse (ADR today) or defer, queueing the mention until the holder's session ends, as Paperclip does. Recommendation: keep refuse in Phase 6 and revisit with usage data. |
| Release rules: in_progress → todo; terminal items keep the record of who worked | ADR 0003 §2 change table | **Adapt.** Islestone keeps the assignee always; the delegate field follows ADR 0003's table, and "who worked" lives in the ended session. |
| `adminForceRelease` | ADR 0003 §5 (`ENDED_BY_PERSON`) | **Adapt** into "a person with permission ends the session", audited. |
| Durable wake queue, coalescing, deferral, `skipped` rows with reasons | ADR 0003 §4 invocation table; roadmap 6.3 invocation; 5.1 automation | **Adapt.** Islestone has BullMQ for delivery but needs a durable record of every invocation, including refused ones. Add `AgentInvocation` (or put source and refusal reason on a `PENDING` session row) with an idempotency key. A mention into a live session is ADR 0003's "joins the live session as a `PROMPT`", which is Paperclip's coalesce. |
| Invocation sources `timer`, `assignment`, `on_demand`, `automation` | ADR 0003 §4: `SCHEDULE`, `DELEGATION`, `MENTION`, `AUTOMATION` | **Map one to one:** timer → SCHEDULE, assignment → DELEGATION, on_demand (mention or manual) → MENTION, automation → AUTOMATION. |
| Per-agent `maxConcurrentRuns`, `maxDailyRuns`, `maxDailyCostCents` | Policy card actions per run and per day (ADR 0003 §4, §11); 6.1 caps | **Take the daily caps,** as policy-card fields reserved before the call, as inflect-compliance does. Phase 6 does not need concurrency per agent beyond one session per item. |
| Budget scopes company / agent / project; tightest wins | ADR 0003 §11 (agent, project, workspace; "the smallest") | **Take.** It matches. Paperclip's company scope is Islestone's workspace AI budget (8.1). |
| Reservation: one row per run, unique; locks then admit | ADR 0003 §11 "reserve before the run" | **Take the shape:** a reservation table unique per run, written under share locks on the tenant, project and agent plus a lock on the run, READ COMMITTED with bounded retries. **Change the estimate:** derive it from the run's caps (maximum cost), not a per-policy constant, so the hard stop is real and not just "admission was constrained". |
| Hard-stop incidents: soft at warn %, hard at the limit, one per window, linked to an approval; keep paused, or raise and resume | ADR 0003 §11 ("on a stop", notifications); H6 | **Take.** Add a `BudgetIncident` table; the "raise and resume" decision is a human action and is audited. The new amount must exceed observed spend. |
| `unpricedUsagePolicy = block` by default | ADR 0003 open question 3 (unit) | **Take.** It is evidence for the recommended answer: money in minor units with a pinned price table, `numeric` for fractional cents, and unpriced usage blocking by default. |
| `amount = 0` means no limit | ADR 0003 §11 (finite budget required) | **Reject.** Islestone requires a finite budget per agent; zero means zero. |
| Asynchronous enforcement worker cancelling running work | ADR 0003 §11; inflect-compliance #4196 | **Reject as the main stop.** Islestone checks the budget and caps before every model call; a worker may still sweep, but it is not the brake. |
| Accounting separate from run completion; append-only cost ledger with an idempotency key per provider receipt | H6 ("cost per run recorded and visible"); 6.6 | **Take the ledger shape** (`CostEvent` per model call: provider, model, tokens, cost, receipt key unique per tenant, links to agent, session, run, item, project, goal). |
| Run row with events numbered by `seq` | ADR 0003 §6 `AgentActivity(seq)`; 6.1 run store | **Already covered** by the inherited run store and ADR 0003's activity table. Paperclip confirms the shape; nothing new to take. |
| Silence thresholds 5 and 15 minutes | ADR 0003 open question 6 (10 and 30 minutes) | **Data point** for the owner. Paperclip's critical bound (15 minutes of output silence) is shorter than the recommended 30-minute heartbeat bound. |
| Approval gate: idempotent conditional resolve; `revision_requested` and resubmit loop | ADR 0003 §8; roadmap 6.2 | **Take the idempotent resolve** (`applied: false`, not an error, on a repeated decision). The revision loop is an **open question:** `ProposalStatus` has no "sent back" state; today the agent proposes again. Do not take the generic unvalidated JSON payload: the inherited queue validates per kind, encrypts and expires. |
| Agent org chart (`reportsTo`), hiring approvals | ADR 0003 §3 (agent owned by a person); principle 1 | **Reject the concept.** Agents do not report to agents in Islestone. **Take the algorithm:** write-time cycle check, recursive CTE with a depth cap, and health classification. Use it for the work-item parent tree (2.1) and the goal and initiative tree (3.2). The idea "a terminated ancestor invalidates descendants" maps to ADR 0003's "owner leaves → agents suspended". |
| `responsibleUserId` on runs, keys and cost events; "bounded by the responsible user's current authority" | ADR 0003 §4 (authorising person, re-read at each run) | **Confirms ADR 0003.** Store the authorising person on the session and each run, and re-read their authority. |
| Goal tree, goal fallback, ancestry CTE (5.8) | Roadmap 3.2; principle "goal ancestry on every work item" (2.2 idea 2) | **Take and extend.** Take the fallback rules (explicit, then project, then workspace default) and the depth-capped, path-guarded recursive CTE. Add what Paperclip lacks: a cycle check on the goal tree, a single statement walking item → parents → project → initiative → goal chain (3.2 asks for one query), and progress roll-up plus a person-set health status. Choose one project ↔ goal relation: Paperclip has both `projects.goalId` and `project_goals`. |
| `goals.ownerAgentId` | Principle 1 | **Reject.** A goal's owner is a person (membership FK). |
| Pure-domain / application / adapters module rule | Global preamble layering | **Confirms** the existing layering; no action. |
| Project `maxConcurrentTasks` and execution admissions | Roadmap 3.5 (capacity), later | **Defer.** Not needed for Phase 6. |
| No RLS | Principle 5; global preamble | **Add** RLS, a tenant-leading index and a two-tenant test to every table built from this study. |

## 7. What Islestone must NOT take

- **Copyleft:** none exists in this repository. Nothing at the pinned commit is GPL, AGPL, SSPL, BUSL or source-available.
- **Revisions before the licence:** anything from a commit before `63afce369` (2026-03-07). Reading the pinned commit avoids this.
- **Third-party subtrees with other holders or licences:** `docker/`, `tests/runner-e2e/` (Apache-2.0 derived schema; would need its NOTICE handling), `ui/public/fonts/`, `packages/paperclip-runner/devtools/issue-thread/src/fonts/`, `ui/public/brands/` (third-party trademarks), `packages/adapters/hermes/`, `packages/shared/src/cliplab/`, `skills/complain/`, `skills/suggestion-box/`, `.agents/skills/*`, `tests/runner-e2e/fixtures/accessibility-source/`. None is needed for this study's scope. Taking any would need that holder's notice as well.
- **The name and brand** "Paperclip" and its logos: MIT does not license trademarks.
- **Product-model choices that contradict Islestone's ADRs and principles:**
  - an agent as the assignee (`assigneeAgentId` in place of the person);
  - agents managing agents: the org chart as authority, "hire" approvals, a CEO agent;
  - agents writing directly (creating issues, changing status) without a proposal; Islestone requires proposals (principle 2, ADR 0003 §4);
  - `amount = 0` meaning an unlimited budget;
  - asynchronous budget enforcement as the only stop;
  - goals owned by agents;
  - generic JSON approval payloads without per-kind validation, encryption or expiry;
  - JSONB catch-alls (`contextSnapshot`, `resultJson`, `executionState`, `executionPolicy`) as the place where state lives. Islestone gives each fact a column and a CHECK.
- **File copies of `issues.ts` or `heartbeat/queue.ts`.** Their size comes from paths Islestone does not have, and copying them would import that complexity. Re-implement the cores in section 5.

## 8. Attribution Islestone would carry

MIT requires the copyright and permission notice in "all copies or substantial portions of the Software". If Islestone only re-implements designs, no copy is made. The roadmap still requires every port to be recorded (principle 6), and a translated schema or close re-implementation can come near "substantial portions". So carry both items below whenever anything in section 6 marked Take or Adapt is built.

`PROVENANCE.md` entry (one per adapted piece):

```
- Source: https://github.com/paperclipai/paperclip
  Commit: 8285a81280db17898f38827a9f3c90221a82f23c
  Licence: MIT, Copyright (c) 2025 Paperclip AI (root LICENSE, added in PR #151, 2026-03-07)
  Paths: <e.g. packages/db/src/schema/budget_policies.ts; server/src/services/budget-reservations.ts>
  What was taken: <design | schema shape | algorithm>, re-implemented in Prisma and the Islestone usecase layer
  Changes: <e.g. agent is a delegate, not the assignee; estimate derived from run caps; RLS added; amount 0 is not unlimited>
```

Third-party notice (in `NOTICE` or `THIRD_PARTY_LICENSES`, as roadmap 0.3 decides):

```
Portions of Islestone's agent checkout, budget and goal-ancestry logic are adapted from
Paperclip (https://github.com/paperclipai/paperclip), commit 8285a81280db17898f38827a9f3c90221a82f23c.

MIT License

Copyright (c) 2025 Paperclip AI

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

ADR 0003's Context says Paperclip was "not read here" and requires its licence to be re-read and its commit pinned (H0) before any of its code is used. This study does both; the ADR can cite this pin when it is next revised.

## 9. Open items for the owner, from this study

1. Checkout mutex: add `WorkItem.liveSessionId` as the conditional-update claim beside the partial unique index (recommended), or keep the index alone.
2. A second agent's mention on a checked-out item: refuse (ADR 0003 today, recommended for Phase 6) or defer behind the holder.
3. A "sent back for revision" proposal state, or proposing again (today).
4. Stale bounds: Paperclip's 5 and 15 minutes of output silence against ADR 0003's recommended 10 and 30 minutes.
5. Budget unit: this study supports money in minor units with `numeric` precision, a pinned price table, and unpriced usage blocking by default (ADR 0003 open question 3).

## Licence check

**CORRECTED** (independent re-check, 2026-11-18; only files and git metadata were read, nothing was run). The core fact stands: the code at `8285a81280db17898f38827a9f3c90221a82f23c` is MIT, "Copyright (c) 2025 Paperclip AI", with no copyleft, source-available or `ee/` portion.

- Pin: `https://raw.githubusercontent.com/paperclipai/paperclip/8285a81280db17898f38827a9f3c90221a82f23c/LICENSE` answered 200 with 21 lines, git blob `a63594a5150d0ae00c3ddc36b61fa8f708c3ca8c`, SHA-256 `7f8a27f0979bded50e240caa8c8c29f3088ddf87032cb83e5a9732bff91d18b4`, identical to the clone's `HEAD:LICENSE`. Its body is word-for-word the standard MIT text. A commits-only fetch shows the pin is an ancestor of the remote `master` tip `33fac97` (3 commits behind it), and the LICENSE is unchanged at the tip.
- Corrected in section 1: the unlicensed history is 597 commits, not 501 (560 on `master` before PR #151 plus 37 late-merged branch commits), so the "nothing before `63afce369`" rule is restated as an ancestry rule; the LICENSE was contributed by an outside contributor and adopted by the maintainer's merge; the README names "Paperclip Labs, Inc" (2026) as holder where the LICENSE says "Paperclip AI" (2025); the migration count is 497 SQL files, not 498; package manifests first declared MIT on 2026-03-17; the third-party licence list now names each file, including two the given list omitted (`ui/public/brands/apps/LOBE-LICENSE`, `ui/public/fonts/PaperMono-OFL.txt`).
- Confirmed: no per-file copyright or SPDX header in any of the 2,847 non-test `.ts` files under `packages/db/src/schema/` and `server/src/services/`, so the root notice covers everything section 3 names; section 8's notice text matches the LICENSE verbatim.
- Not verified: the legal identity behind either holder name, and GitHub's licence detection (API not reachable from this session).
