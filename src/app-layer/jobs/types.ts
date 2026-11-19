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
 * adds the key-rotation jobs here, and each later sub-phase adds its own: a
 * `JobPayloadMap` key, its payload interface and its `JOB_DEFAULTS` entry
 * together, since `JOB_DEFAULTS` is a `Record<JobName, …>`.
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
};

/** The single queue name used for all jobs (BullMQ supports named jobs within a queue) */
export const QUEUE_NAME = 'islestone-jobs';
