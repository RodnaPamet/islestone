/**
 * Job Types — Typed Payload Contracts
 *
 * Every async job in the system is defined here with a unique name,
 * a serialization-safe payload interface, and default queue options.
 *
 * Rules:
 *   1. Job names are string literals (no enums — easier to grep/trace)
 *   2. Payloads MUST be JSON-serializable (no Date objects, no functions, no classes)
 *   3. Each job name maps to exactly one payload type via JobPayloadMap
 *   4. Add new jobs by extending JobPayloadMap + registering a processor
 *
 * TENANT ISOLATION (CRITICAL):
 *   5. Every tenant-scoped payload MUST include `tenantId?: string`
 *   6. Executors MUST pass payload.tenantId to the service layer
 *   7. Services MUST apply tenantId to ALL Prisma where clauses
 *   8. NEVER use `_payload` (unused parameter) in executors — this silently
 *      drops tenantId and causes all-tenant scans
 *      (`tests/guards/executor-payload-forwarding.test.ts` refuses a
 *      registration that takes `_payload`)
 *
 * Rewritten from inflect-compliance `src/app-layer/jobs/types.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (the source as template): the
 * `JobRunResult` contract, `NamesEveryField`, and two of
 * its 78 jobs, `health-check` and `notification-outbox-flush`. Sub-phase 1.5b
 * added three more from the same file: `audit-outbox-flush`, `key-rotation`
 * (without the source's `apiKeyId`, which returns with API keys in 5.2) and
 * `tenant-dek-rotation`. Each later sub-phase adds its own: a `JobPayloadMap`
 * key, its payload interface and its `JOB_DEFAULTS` entry together, since
 * `JOB_DEFAULTS` is a `Record<JobName, …>`.
 *
 * @module app-layer/jobs/types
 */

// ─── Unified Job Run Result ───

/**
 * Universal result contract returned by every scheduled job executor.
 * Provides a consistent shape for observability, logging, and
 * downstream consumers (dashboards, audit logs, alerting).
 *
 * All fields are JSON-serializable.
 */
export interface JobRunResult {
    /** The job name that produced this result */
    jobName: string;
    /** Unique identifier for this particular execution */
    jobRunId: string;
    /** Whether the job completed without throwing */
    success: boolean;
    /** ISO timestamp of when execution started */
    startedAt: string;
    /** ISO timestamp of when execution finished */
    completedAt: string;
    /** Execution duration in milliseconds */
    durationMs: number;
    /** Number of items scanned/inspected during the run */
    itemsScanned: number;
    /** Number of items that triggered an action (e.g. notified, archived, purged) */
    itemsActioned: number;
    /** Number of items skipped (duplicate, already processed, etc.) */
    itemsSkipped: number;
    /** Optional error message if success=false */
    errorMessage?: string;
    /**
     * Set when a failure must NOT be retried by the queue.
     *
     * The queue defaults to `attempts: 3` with 5s exponential backoff, which is
     * right for a transient fault and actively harmful for two cases:
     *
     *   - a REVOKED CREDENTIAL, where three retries are pure delay for every
     *     other tenant behind this job in the fan-out;
     *   - a RATE LIMIT, where retrying the whole sync three times inside ~35s
     *     is precisely what the remote just asked us not to do, and can turn a
     *     soft throttle into a hard block.
     *
     * The worker converts this into BullMQ's `UnrecoverableError`. The job
     * still FAILS and is still recorded — it simply is not re-run before the
     * next scheduled tick.
     */
    noRetry?: boolean;
    /** Optional structured details (job-specific payload) */
    details?: Record<string, unknown>;
}

// ─── Job Payload Definitions ───

/** Health check / smoke test job */
export interface HealthCheckPayload {
    /** ISO timestamp of when the job was enqueued */
    enqueuedAt: string;
    /** Optional message for testing */
    message?: string;
}

/**
 * Notification outbox flush — drain PENDING rows to the email provider.
 *
 * The outbox's only scheduled drain, every ten minutes. (In inflect-compliance
 * the drain lived at the tail of a 06:00 evidence job, so mail enqueued
 * outside that window waited up to a day; it got its own job for that reason.)
 *
 * `tenantId` is OPTIONAL and the two shapes mean different things. Absent is
 * the scheduled drain, which legitimately spans every tenant. Present narrows
 * it to one tenant, which is what an operator re-running a stuck queue wants —
 * and what the tenant-scoped admin route already does for the same reason:
 * `processOutbox` without a tenant sends EVERY tenant's mail, so a caller who
 * has one tenant in mind must say so.
 *
 * `limit` caps rows per pass. Optional so the schedule does not restate the
 * job's own default; present so an operator draining a backlog can widen one
 * run without editing the schedule.
 */
export interface NotificationOutboxFlushPayload {
    tenantId?: string;
    limit?: number;
}

/**
 * Drain queued audit entries onto the hash chain (sub-phase 1.5b).
 *
 * `appendAuditEntryOrQueue` writes an `AuditOutbox` row when the chain write
 * fails; this job replays those rows, oldest event first. Same two shapes as
 * the notification drain: no `tenantId` is the scheduled drain of every
 * workspace, a `tenantId` narrows it to one. `maxAttempts` is how many replays
 * a row gets before it is parked FAILED (default 5).
 */
export interface AuditOutboxFlushPayload {
    tenantId?: string;
    limit?: number;
    maxAttempts?: number;
}

/**
 * Master-KEK rotation, one workspace at a time (sub-phase 1.5b).
 *
 * Enqueued by `POST /api/t/:slug/admin/key-rotation` after an operator has
 * staged `DATA_ENCRYPTION_KEY_PREVIOUS` alongside the new
 * `DATA_ENCRYPTION_KEY`. The job:
 *   1. Re-wraps the workspace's `encryptedDek` under the primary KEK.
 *   2. Re-encrypts every v1 ciphertext belonging to this workspace
 *      under the primary KEK.
 *
 * Idempotent — the dual-KEK fallback transparently decrypts whatever
 * state the row is in, so a re-run after a crash continues from
 * wherever the last batch stopped.
 *
 * inflect-compliance's payload also carries `apiKeyId`, the API key the
 * rotation was requested with, re-read for liveness before any work. API
 * keys arrive in sub-phase 5.2, which restores the field and the check.
 */
export interface KeyRotationPayload {
    tenantId: string;
    /** User who initiated — attribution on audit-log entries. */
    initiatedByUserId: string;
    /** Upstream request id for log correlation. */
    requestId?: string;
}

/**
 * Per-tenant DEK rotation re-encrypt sweep (sub-phase 1.5b).
 *
 * Enqueued by `rotateTenantDek` after the atomic DEK swap. The job:
 *   1. Walks every (model, field) in the encrypted-fields manifest
 *      that has a `tenantId` column.
 *   2. For each row carrying a v2 ciphertext, decrypts under the
 *      previous DEK and re-encrypts under the new primary DEK.
 *   3. On completion, clears `Tenant.previousEncryptedDek` to NULL
 *      and invalidates the previous-DEK cache for that tenant.
 *
 * Idempotent — the dual-DEK fallback in the encryption middleware
 * means rows already rewritten under the new primary stay readable
 * if the job re-runs after a crash. The job's own decrypt path uses
 * the previous DEK directly (not the fallback) because rows that
 * primary-decrypt successfully are by definition NOT what we're
 * sweeping for.
 *
 * Mid-flight reads remain correct via the middleware's
 * `decryptWithKeyOrPrevious` fallback (the previous DEK stays
 * resolvable until the final UPDATE clears `previousEncryptedDek`).
 */
export interface TenantDekRotationPayload {
    tenantId: string;
    /** User who initiated — attribution on audit-log entries. */
    initiatedByUserId: string;
    /** Upstream request id for log correlation. */
    requestId?: string;
    /** Override SELECT batch size per (model, field). Default 500. */
    batchSize?: number;
}

/**
 * Daily in-app due-date reminders for work items (sub-phase 2.2). No
 * `tenantId` sweeps every live workspace; a `tenantId` re-runs one.
 */
export interface WorkItemDueNotificationPayload {
    tenantId?: string;
}

/**
 * Daily hard delete of work items and projects past the soft-delete window
 * (ADR 0002 §8). No `tenantId` sweeps every workspace.
 */
export interface WorkItemPurgePayload {
    tenantId?: string;
}

/**
 * Nightly goal purge (sub-phase 3.2a, owner decision 219): goals and
 * initiatives deleted more than `GOAL_PURGE_DAYS` ago. No `tenantId` sweeps
 * every live workspace.
 */
export interface GoalPurgePayload {
    tenantId?: string;
}

/**
 * Daily cycle rollover (sub-phase 2.5a): close ended cycles, move their
 * unfinished items on, keep the schedules filled. No `tenantId` sweeps every
 * workspace with cycles; a `tenantId` re-runs one.
 */
export interface CycleRolloverPayload {
    tenantId?: string;
}

/**
 * Daily, 08:00 in NOTIFICATIONS_TZ (sub-phase 2.6a, owner decision 90): wake
 * the snoozed intake requests whose day has come. No `tenantId` sweeps every
 * workspace with a snoozed request; a `tenantId` re-runs one.
 */
export interface IntakeSnoozeWakePayload {
    tenantId?: string;
}

/**
 * Daily (sub-phase 2.6a, owner decision 90): hard-delete decided intake
 * requests 90 days after the decision, spam after 7.
 */
export interface IntakePurgePayload {
    tenantId?: string;
}

/**
 * One inbound email delivery to fetch and file (sub-phase 2.6c, decision
 * 122): enqueued by the webhook with the delivery row's id as the job id.
 */
export interface IntakeEmailFetchPayload {
    tenantId: string;
    inboundId: string;
}

/**
 * Nightly repeats (sub-phase 2.5d): make each due occurrence as the person
 * who set the repeat, re-resolved. No `tenantId` sweeps every workspace with
 * a running repeat; a `tenantId` re-runs one.
 */
export interface WorkItemRecurrencePayload {
    tenantId?: string;
}

/**
 * The daily digest (sub-phase 2.7c, owner decision 133): 08:10 in
 * `NOTIFICATIONS_TZ`, one email per ACTIVE member of each live workspace with
 * their due items and the day's unread notifications of their DAILY types. A
 * `tenantId` re-runs one workspace.
 */
export interface NotificationDigestPayload {
    tenantId?: string;
}

/**
 * Notification retention (sub-phase 2.7c, owner decision 135): Done rows 90
 * days after they were marked Done, read rows 180 days after they were read;
 * unread rows are kept. A `tenantId` narrows it to one workspace.
 */
export interface NotificationPurgePayload {
    tenantId?: string;
}

/**
 * Search vectors (sub-phase 2.7f, ADR 0008): nightly, the sources whose vector
 * is missing or older than `SEARCH_VECTOR_REVISION` in every live workspace;
 * on demand (an admin's request) every source of one workspace (`force`), run
 * as the admin who asked, re-resolved when it runs (`requestedByUserId`).
 */
export interface SearchIndexRebuildPayload {
    tenantId?: string;
    force?: boolean;
    requestedByUserId?: string;
}

/**
 * Calendar sync (roadmap 3.3b; ADR 0011; decision 233): every 15 minutes the
 * dispatcher enqueues one run per live connection (and a teardown per
 * connection being disconnected); a run pushes one connection's items and
 * milestones; a teardown deletes Islestone's events, then the token, then the
 * rows (decision 239). No payload names a person: each run reads the
 * connection's own member and re-resolves them.
 */
export interface CalendarSyncDispatchPayload {
    tenantId?: string;
}
export interface CalendarSyncConnectionPayload {
    tenantId: string;
    connectionId: string;
}
export interface CalendarTeardownPayload {
    tenantId: string;
    connectionId: string;
}

/** Daily rebalance of projects whose sort keys passed the length bound (ADR 0002 §5). */
export interface WorkItemSortKeyRebalancePayload {
    tenantId?: string;
}

/**
 * Every key of `T` required to be PRESENT, keeping each key's own value type.
 *
 * The executor registrations name payload fields one by one rather than
 * spreading, because a payload forwarded opaquely is how a scoped job silently
 * becomes an unscoped one. That discipline is right and stays. What it lacked
 * was a way to tell "this field is deliberately not forwarded" from "nobody
 * updated this call site" — and an OPTIONAL field cannot tell them apart,
 * because `{tenantId, provider}` type-checks perfectly against a payload whose
 * third field is `requestedByUserId?: string`.
 *
 * That is not hypothetical. In inflect-compliance (#2870) a requester field was
 * added to a payload and threaded through the route and the job; the executor
 * in between kept naming two fields, the compiler had nothing to say, and every
 * manual run recorded itself as an unattended schedule for the life of the fix.
 *
 * Annotating the forwarded object with this type makes the NAMING mandatory
 * while leaving the VALUE optional — `Required<T>` would strip `| undefined`
 * from the value too and force a real user id onto a scheduled dispatch, which
 * has none and should not invent one.
 */
export type NamesEveryField<T> = { [K in keyof Required<T>]: T[K] };

export interface JobPayloadMap {
    'health-check': HealthCheckPayload;
    'notification-outbox-flush': NotificationOutboxFlushPayload;
    'audit-outbox-flush': AuditOutboxFlushPayload;
    'key-rotation': KeyRotationPayload;
    'tenant-dek-rotation': TenantDekRotationPayload;
    'work-item-due-notification': WorkItemDueNotificationPayload;
    'work-item-purge': WorkItemPurgePayload;
    'goal-purge': GoalPurgePayload;
    'work-item-sortkey-rebalance': WorkItemSortKeyRebalancePayload;
    'cycle-rollover': CycleRolloverPayload;
    'intake-snooze-wake': IntakeSnoozeWakePayload;
    'intake-purge': IntakePurgePayload;
    'intake-email-fetch': IntakeEmailFetchPayload;
    'work-item-recurrence': WorkItemRecurrencePayload;
    'notification-digest': NotificationDigestPayload;
    'notification-purge': NotificationPurgePayload;
    'search-index-rebuild': SearchIndexRebuildPayload;
    'calendar-sync-dispatch': CalendarSyncDispatchPayload;
    'calendar-sync-connection': CalendarSyncConnectionPayload;
    'calendar-teardown': CalendarTeardownPayload;
}

/** Union of all valid job names */
export type JobName = keyof JobPayloadMap;

/** Extract the payload type for a given job name */
export type JobPayload<T extends JobName> = JobPayloadMap[T];

// ─── Default Queue Options ───

/** Default retry/backoff settings per job */
export const JOB_DEFAULTS: Record<JobName, {
    attempts: number;
    backoff: { type: 'exponential' | 'fixed'; delay: number };
    removeOnComplete: number | boolean;
    removeOnFail: number | boolean;
}> = {
    'health-check': {
        attempts: 1,
        backoff: { type: 'fixed', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 200,
    },
    'notification-outbox-flush': {
        // ONE attempt, and the cadence is why. This runs every ten minutes, so
        // "retry" already has a name: the next tick. A BullMQ retry five
        // seconds after a failure re-enters the same dead SMTP host or the same
        // unreachable database, and three of those per tick turns an outage
        // into a retry storm against a third party's mail server.
        //
        // Nothing is lost by declining the retry. A row is claimed atomically
        // before its send and its `attempts` column is the optimistic-
        // concurrency token, so a pass that dies mid-batch leaves every
        // unclaimed row PENDING for the next pass and every claimed one
        // accounted for. Per-MESSAGE retry is a different mechanism that still
        // applies: `processOutbox` gives each row three attempts before it goes
        // permanently FAILED, and those are spread across ticks rather than
        // burned inside one.
        attempts: 1,
        backoff: { type: 'fixed', delay: 0 },
        removeOnComplete: 50,
        removeOnFail: 200,
    },
    'audit-outbox-flush': {
        // ONE attempt, for the same reason as `notification-outbox-flush`:
        // this runs every five minutes, so "retry" already has a name — the
        // next tick. A BullMQ retry seconds after a failure re-enters the same
        // unreachable database.
        //
        // Nothing is lost by declining it. Each row is claimed atomically
        // before its replay and `attempts` is the optimistic-concurrency
        // token, so a pass that dies mid-batch leaves unclaimed rows PENDING
        // for the next pass. Per-ROW retry is the separate mechanism that
        // still applies: five attempts with backoff before a row is parked
        // FAILED, and a parked row is never deleted.
        attempts: 1,
        backoff: { type: 'fixed', delay: 0 },
        removeOnComplete: 50,
        removeOnFail: 200,
    },
    'key-rotation': {
        // Do NOT auto-retry: a partial rotation needs operator review.
        // The job is idempotent, so the operator can re-enqueue after
        // investigating; we'd rather they see "this one failed" in the
        // completed-with-errors state than have the queue silently
        // retry and potentially compound the problem.
        attempts: 1,
        backoff: { type: 'fixed', delay: 0 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
    'tenant-dek-rotation': {
        // Same posture as key-rotation: a partial sweep means
        // `Tenant.previousEncryptedDek` is still populated and reads
        // continue working via the dual-DEK fallback. The operator
        // re-enqueues manually after investigating any failure;
        // silent auto-retry could compound a partial-progress bug.
        attempts: 1,
        backoff: { type: 'fixed', delay: 0 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
    'work-item-due-notification': {
        // Two attempts with exponential back-off from 5 s (the source's
        // `task-due-notification` options): a retry the same morning is
        // harmless, the dedupe key absorbs a re-run.
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'work-item-purge': {
        // One attempt: the next daily run is the retry, and every batch it
        // finished is already committed.
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'goal-purge': {
        // One attempt: the next nightly run is the retry, and every page it
        // finished is already committed.
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'work-item-sortkey-rebalance': {
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'notification-digest': {
        // Two attempts, ten minutes apart: a retry mails nobody twice (the
        // outbox dedupes per address, workspace and day), and a digest that
        // failed at 08:10 is still worth sending at 08:20.
        attempts: 2,
        backoff: { type: 'fixed', delay: 600_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'notification-purge': {
        // Two attempts: a retry deletes only what is still past its window.
        attempts: 2,
        backoff: { type: 'fixed', delay: 300_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'search-index-rebuild': {
        // Two attempts: a retry rewrites only what is still missing or old
        // (a forced run rewrites every row again, which changes nothing).
        attempts: 2,
        backoff: { type: 'fixed', delay: 300_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'work-item-recurrence': {
        // Two attempts, five minutes apart: a retry makes nothing twice (each
        // occurrence is claimed on its stamped date, and the occurrence unique
        // backs it).
        attempts: 2,
        backoff: { type: 'fixed', delay: 300_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'cycle-rollover': {
        // Two attempts, five minutes apart: a retry the same night is
        // harmless (closed cycles are not closed twice), and a cycle left
        // ended until the next night holds its items a day longer.
        attempts: 2,
        backoff: { type: 'fixed', delay: 300_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'intake-snooze-wake': {
        // Two attempts, five minutes apart: a retry is harmless (the wake is
        // conditional), and a request left snoozed until the next morning
        // comes back a day late.
        attempts: 2,
        backoff: { type: 'fixed', delay: 300_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'intake-email-fetch': {
        // Five attempts, backing off from 30 seconds: Resend or the download
        // may be briefly unavailable. A retry is harmless (the delivery row is
        // claimed per attempt, a stored message is never stored twice), and
        // the last attempt settles the row FAILED itself.
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
    'intake-purge': {
        // One attempt: the next daily run is the retry, and every batch it
        // finished is already committed.
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'calendar-sync-dispatch': {
        // One attempt: the next quarter hour is the retry.
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 30,
        removeOnFail: 100,
    },
    'calendar-sync-connection': {
        // One attempt (the map's "the next bucket is the retry"): a run is a
        // reconcile, so the next one repeats exactly what is still missing; a
        // revoked token is terminal and never retried.
        attempts: 1,
        backoff: { type: 'fixed', delay: 60_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
    },
    'calendar-teardown': {
        // Three attempts a few minutes apart; a teardown still unfinished is
        // enqueued again by the dispatcher every quarter hour.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
    },
};

/** The single queue name used for all jobs (BullMQ supports named jobs within a queue) */
export const QUEUE_NAME = 'islestone-jobs';
