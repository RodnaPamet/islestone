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
 * `JobRunResult` contract, the due-item shapes, `NamesEveryField`, and two of
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

// ─── Normalized Due Item Output ───

/**
 * Entity types that can have due/expiring items.
 * Used for downstream notification grouping.
 */
export type MonitoredEntityType =
    // A work item's due date (sub-phase 2.x). Sub-phase 2.7 widens this list
    // when its monitors add entity types.
    | 'WORK_ITEM';

/**
 * Urgency classification for due items.
 *   OVERDUE  — already past its deadline
 *   URGENT   — within 7 days
 *   UPCOMING — within 30 days
 */
export type DueItemUrgency = 'OVERDUE' | 'URGENT' | 'UPCOMING';

/**
 * Normalized due/expiring item — the universal output of all monitors.
 *
 * Designed for downstream consumption:
 *   - Group by tenantId + ownerUserId → per-user digest
 *   - Group by entityType → summary dashboards
 *   - All fields are JSON-serializable
 */
export interface DueItem {
    /** Entity type being monitored */
    entityType: MonitoredEntityType;
    /** Database ID of the entity */
    entityId: string;
    /** Tenant that owns this entity */
    tenantId: string;
    /** Human-readable name/title */
    name: string;
    /** Specific reason this item is flagged */
    reason: string;
    /** Urgency classification */
    urgency: DueItemUrgency;
    /** The date that drives this due item (ISO string) */
    dueDate: string;
    /** Days remaining (negative = overdue) */
    daysRemaining: number;
    /** Owner user ID (for notification routing), if known */
    ownerUserId?: string;
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
};

/** The single queue name used for all jobs (BullMQ supports named jobs within a queue) */
export const QUEUE_NAME = 'islestone-jobs';
