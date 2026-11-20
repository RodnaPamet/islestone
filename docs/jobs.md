# Background jobs

Sub-phase 1.6. Work that does not belong in a request runs on a BullMQ queue
backed by Redis, in a separate worker process.

Copied and edited from inflect-compliance's job layer at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` and its `docs/worker-autoscaling.md`
(`PROVENANCE.md`, "Copied: jobs, notifications and observability"). Five jobs
are registered: 1.6's two, and sub-phase 1.5b's audit-outbox drain and two key
rotations (`PROVENANCE.md`, "Copied: rotation and outbox drain"). Every later
job is an addition to the registry, the payload map and the schedule or the
on-demand list.

## The pieces

```
enqueue(name, payload)            scripts/scheduler.ts (once per deploy)
  src/app-layer/jobs/queue.ts       registers SCHEDULED_JOBS as repeatables
           │                                    │
           ▼                                    ▼
      Redis: BullMQ queue `islestone-jobs` (noeviction)
           │
           ▼
scripts/worker.ts  ──►  executorRegistry.execute(name, payload)
  (concurrency 5)        src/app-layer/jobs/executor-registry.ts
                              │
                              ▼
                        registered executors
```

| File | What |
|---|---|
| `src/app-layer/jobs/types.ts` | `JobPayloadMap` (the job names and their typed payloads), `JOB_DEFAULTS` (attempts, backoff, retention per job), `JobRunResult`, `QUEUE_NAME`, the due-item shapes for 2.2's reminders, and `NamesEveryField`. |
| `queue.ts` | `enqueue(name, payload, options?)`: typed, refuses a custom job id BullMQ would reject (`:` and the like), carries the caller's trace context in the payload. `closeQueue()` closes the queue and quits its connection. |
| `executor-registry.ts` | One executor per job name, registered once (a duplicate throws). `execute` never throws: a failure becomes a `JobRunResult` with `success: false`, and a `NonRetryableJobError` also sets `noRetry`. |
| `schedules.ts` | `SCHEDULED_JOBS` (the cron table) and `RETIRED_SCHEDULER_NAMES`. |
| `register-schedules.ts` | Upserts every scheduled job and removes schedulers this app defines but no longer schedules, never one it does not know. |
| `non-retryable.ts` | `NonRetryableJobError(message, 'terminal' \| 'rate_limited')`: thrown by a job whose retry cannot succeed. The worker turns it into BullMQ's `UnrecoverableError` and `job.queue.retry_bypassed` counts it. 5.3's integration errors extend it, so the registry never imports integration code. |
| `fan-out.ts`, `drain-pages.ts`, `tenant-job-lookup.ts` | Helpers for jobs that fan out per workspace: deterministic, BullMQ-valid job ids per time bucket; a paged read that cannot skip rows; finding a workspace's job by id. `findTenantJob` serves the two rotation status routes; the other two are unused today. |
| `worker-heartbeat.ts` | The worker writes `islestone:worker:heartbeat` with an 8-minute TTL after each completed job; `scripts/worker-healthcheck.ts` exits non-zero when the key is gone. The `health-check` job's two-minute cadence keeps it fresh on an idle worker. |

## The jobs

| Job | Schedule | Attempts | What |
|---|---|---|---|
| `health-check` | every 2 minutes | 1 | Answers `pong` with its payload. Proves the queue, the worker and the registry agree, and keeps the heartbeat fresh. |
| `notification-outbox-flush` | every 10 minutes | 1 | Drains the email outbox (`processOutbox`, `docs/notifications.md`). Every workspace by default; a payload naming `tenantId` drains only that one. One attempt, because the next tick is the retry and each row has its own three. |
| `audit-outbox-flush` | every 5 minutes | 1 | Replays queued audit entries onto the hash chain, oldest event first (`docs/audit-trail.md`, "The drain"). Every workspace by default, or the `tenantId` the payload names; `limit` and `maxAttempts` per pass. One attempt, because the next tick is the retry and each row has its own five. |
| `key-rotation` | on demand | 1 | Master-key rotation for one workspace: re-wraps its DEK and re-encrypts its `v1:` ciphertexts under the new `DATA_ENCRYPTION_KEY` (`docs/encryption.md`). Enqueued by `POST /api/t/:slug/admin/key-rotation` (OWNER-only). A run with errors is a failed job; the operator reads it and re-enqueues (the sweep is idempotent). |
| `work-item-due-notification` | daily, 08:00 in `NOTIFICATIONS_TZ` | 2 | In-app due reminders for open work items due today, tomorrow or in seven days, to the ACTIVE assignee and the ACTIVE member the item waits on (one reminder when they are the same person; decision 137) (`docs/notifications.md`). Every live workspace, each scanned inside its own context in pages of 500, one write and one read-back per page; or the `tenantId` the payload names. Idempotent through the dedupe key. |
| `work-item-purge` | daily, 02:30 UTC | 1 | Hard-deletes work items and projects soft-deleted more than `WORK_ITEM_PURGE_DAYS` (30) ago, per workspace in batches of 500, as the workspace system user; one counts-only `WORK_ITEM_PURGED` entry per workspace (`docs/work-items.md`). The cross-workspace find is `runWithoutRls({ reason: 'cross-tenant-sweep' })`. |
| `work-item-sortkey-rebalance` | daily, 03:45 UTC | 1 | Rewrites a project's `sortKey`s, in order, once any passes 64 characters (ADR 0002 §5). |
| `cycle-rollover` | daily, 00:10 in `NOTIFICATIONS_TZ` | 2 | Sub-phase 2.5a (owner decisions 63 and 64): per team, keeps an enabled cycle schedule filled, closes every open cycle whose last day has passed (a conditional update, so once), and moves its unfinished items (Backlog, Unstarted, Started; live, in a live and unarchived project) to the team's next cycle, or out of cycles when the team says so or no next cycle exists. As the workspace system user (it acts for nobody); one `WORK_ITEM_CYCLE_CHANGED` per moved item and one counts-only `CYCLE_COMPLETED` per cycle; no bell or mail. Workspaces with an open cycle or an enabled schedule, deleted ones skipped (`runWithoutRls({ reason: 'cross-tenant-sweep' })` for the list), each in its own context; one workspace's failure leaves the others' work committed. |
| `intake-snooze-wake` | daily, 08:05 in `NOTIFICATIONS_TZ` | 2 | Sub-phase 2.6a (owner decision 90): snoozed intake requests whose date has come go back to new (a conditional update, so once), with a counts-only `INTAKE_REQUESTS_WOKEN` per batch and a bell to whoever snoozed each while they still hold `intake.view`. As the workspace system user; workspaces with a snoozed request, deleted ones skipped, each in its own context. |
| `intake-purge` | daily, 02:50 UTC | 1 | Sub-phase 2.6a (owner decision 90): hard-deletes intake requests decided more than 90 days ago, spam after 7, in batches of 500 with a counts-only `INTAKE_REQUESTS_PURGED` per batch. The work item an accepted request became is untouched. From 2.6c it also deletes settled inbound email deliveries older than 30 days (`INTAKE_INBOUND_EMAILS_PURGED`, counts only). As the workspace system user. |
| `work-item-recurrence` | daily, 00:30 in `NOTIFICATIONS_TZ` | 2 | Sub-phase 2.5d (owner decisions 68 to 70): for each running repeat whose next occurrence is within its lead days, re-resolves the person who set it (`resolveMemberContext`) and, as them, in one transaction, claims the stamped next date (a conditional update, so once; the `(recurrenceId, occurrenceOn)` unique backs it) and makes the copy through the request's own create (`createWorkItemInTx`), projected from the source as it is (`templateToCreateInput`); only the latest due occurrence after an outage, the rest counted. An owner no longer an active member, without `work_items.create` or without sight of the project, a deleted source, an archived project or a reached end puts the repeat on hold with the reason, written as the workspace system user naming the owner; a copy is never made as the system user. Workspaces with a running repeat, deleted ones skipped; one rule's failure rolls back its claim and leaves the others committed. |
| `intake-email-fetch` | on demand | 5, exponential from 30 s | Sub-phase 2.6c (owner decision 122): one inbound email delivery. Enqueued by the webhook (`receiveInboundEmailEvent`) with the delivery's id as the job id, so BullMQ keeps one per delivery. Claims the pending row, retrieves the email from Resend's API, downloads the raw message (pinned hosts, `safeFetch`, a capped read), and makes the request or follow-up in one transaction, as the workspace system user. A settled row is skipped; a message already stored is not stored twice; a failure a retry cannot fix settles the row `FAILED`, and the fifth attempt does too (`docs/intake.md`, "Inbound email (2.6c)"). |
| `tenant-dek-rotation` | on demand | 1 | The per-workspace DEK sweep: re-encrypts every `v2:` ciphertext from the previous DEK to the new one, then clears `Tenant.previousEncryptedDek`. Enqueued by `rotateTenantDek` (`POST /api/t/:slug/admin/tenant-dek-rotation`). Reports progress (`phase`, counts) through the job, which the route's GET returns. |

The two rotations and `intake-email-fetch` are listed in `ON_DEMAND_JOBS`
(`tests/guards/runtime-wiring-coverage.test.ts`) with the code that enqueues
them, which the guard checks (`intake-email-fetch` acts for nobody and runs as
the workspace system user). A rotation's payload carries `initiatedByUserId`, and the
job resolves that person again when it runs (`resolveRotationActor`,
`src/app-layer/jobs/rotation-actor.ts`): while they are an ACTIVE member holding
`admin.tenant_lifecycle` the job acts as them; otherwise it still finishes, as
the workspace system user, and its audit entries and result record who asked
and why they were not acted for. That fallback is an owner decision
(2026-11-19) for the two rotations only; every other job that does what a
person asked stops when that person does not resolve (`docs/encryption.md`,
"Who a rotation acts as").

Each executor names the payload fields it forwards (`NamesEveryField`), so a
field added to a payload fails `tsc` until it is forwarded or left out on
purpose: a dropped `tenantId` would turn a one-workspace run into a drain of
every workspace. `tests/guards/executor-payload-forwarding.test.ts` refuses an
executor that ignores its payload.

## Adding a job

1. A key in `JobPayloadMap` with its payload interface, and its
   `JOB_DEFAULTS` entry (`tsc` requires both).
2. `executorRegistry.register('<name>', async (payload) => …)` in
   `executor-registry.ts`, the body wrapped in `runJob` (below) and the
   payload fields named.
3. Either an entry in `SCHEDULED_JOBS`, or an `ON_DEMAND_JOBS` entry with its
   reason in `tests/guards/runtime-wiring-coverage.test.ts`. A job that is
   neither fails CI: it would never run.
4. A job that resolves people to mail must check that their workspace is
   live (`tests/guards/cross-tenant-recipient-liveness.test.ts`).
5. Nothing the worker reaches may import the NextAuth seam or import
   `next/headers`, `next/navigation` or `server-only` statically
   (`tests/guards/worker-import-graph.test.ts`): the worker is plain Node.

A job that writes rows needing a `User` foreign key and acts for nobody uses
`buildTenantSystemJobContext` (`src/app-layer/context-system.ts`): the
workspace's system user, `sys_<tenantId>`, which the database refuses as a
sign-in, membership, credential or session. The call that first creates it
writes one `SYSTEM_USER_CREATED` audit entry in the same transaction (owner
decision, 2026-11-19). A job that does what a person
asked resolves that person's membership again when it runs
(`resolveInitiatorContext`, `resolveMemberContext`); a `null` is a refusal,
never a reason to fall back to a system context.

## Running it

```bash
docker compose up -d          # Redis with noeviction and a password, Postgres
npm run scheduler             # register the repeatable jobs once (tsx)
npm run worker                # the long-running worker (tsx)
npm run build:worker          # bundle worker, scheduler and healthcheck into dist/ (esbuild)
node dist/worker-healthcheck.mjs   # exit 0 when the heartbeat is fresh
```

The worker reads `REDIS_URL` and the database variables from the
environment (`.env.local` is not loaded by `tsx`; export it first). It also
registers the schedules itself at boot, so a skipped scheduler step does not
leave the crons unregistered. On SIGTERM it stops taking jobs, waits for the
running ones, flushes the audit-stream buffers and the telemetry, and exits.

## Redis

- **`REDIS_URL` is required in production and must carry a password**:
  `src/env.ts` refuses the value, and `src/instrumentation-node.ts` refuses
  the start, naming the variable.
- **The eviction policy must be `noeviction`**: an evicting Redis drops
  queued jobs under memory pressure. `docker-compose.yml` sets it, and the web
  process checks it at boot (`verifyRedisEvictionPolicy`): an error in the log
  in production, a warning elsewhere, never a refusal to start, because a
  managed Redis may not answer `CONFIG GET`.
- The rate limiter's Upstash store (`RATE_LIMIT_MODE`) is a separate service
  and is not this Redis.
