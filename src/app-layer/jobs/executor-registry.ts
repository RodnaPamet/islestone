/**
 * Job Executor Registry — Typed Job Dispatch
 *
 * Provides a central, type-safe registry that maps job names to their
 * executor functions. This decouples job *dispatch* from job *scheduling*,
 * allowing any entrypoint (BullMQ worker, Vercel Cron route, node-cron,
 * CLI scripts) to execute jobs through one unified interface.
 *
 * Architecture:
 *   ┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
 *   │ BullMQ      │────▶│                  │────▶│ registered       │
 *   │ Worker      │     │  ExecutorRegistry │     │ executors        │
 *   ├─────────────┤     │                  │     │ (health-check,   │
 *   │ CLI scripts │────▶│  .execute(name,  │     │  notification-   │
 *   │             │     │    payload)       │     │  outbox-flush,   │
 *   │             │     │  .getExecutor()  │     │  …)              │
 *   │             │     │  .listRegistered()│    │                  │
 *   └─────────────┘     └──────────────────┘     └──────────────────┘
 *
 * Usage:
 *   import { executorRegistry } from '@/app-layer/jobs/executor-registry';
 *   const result = await executorRegistry.execute('notification-outbox-flush', {});
 *
 * Adding new jobs:
 *   1. Define payload in types.ts (JobPayloadMap and JOB_DEFAULTS)
 *   2. Create job module (e.g. notification-outbox-flush.ts)
 *   3. Register executor below, naming every payload field it forwards
 *   4. Schedule it in schedules.ts, or record who enqueues it
 *      (tests/guards/runtime-wiring-coverage.test.ts)
 *
 * Copied from inflect-compliance `src/app-layer/jobs/executor-registry.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the registry, `makeResult`,
 * `JobOutcome`, `fanOutOutcome` and `keyRotationOutcome`, with five of its 78
 * registrations (`health-check`, `notification-outbox-flush`, and sub-phase
 * 1.5b's `audit-outbox-flush`, `key-rotation` and `tenant-dek-rotation`). A
 * non-retryable failure is a `NonRetryableJobError` (./non-retryable), so the
 * registry imports no integration code.
 *
 * @module app-layer/jobs/executor-registry
 */
import { logger } from '@/lib/observability/logger';
import { recordJobMetrics, recordQueueRetryBypass } from '@/lib/observability/metrics';
import { isNonRetryableJobError } from './non-retryable';
import type { JobName, JobPayload, JobRunResult, NamesEveryField } from './types';

// ─── Executor Contract ──────────────────────────────────────────────

/**
 * Optional context the worker passes to executors that benefit from
 * mid-run observability hooks. Today only `updateProgress` is wired —
 * forwarded by the BullMQ worker as `(p) => job.updateProgress(p)`.
 * The Vercel Cron / node-cron / CLI entrypoints don't supply this
 * (they run outside a BullMQ Job), so executors must treat the
 * callbacks as optional and degrade gracefully when absent.
 *
 * Payload shape is intentionally `unknown` — each executor designs
 * its own progress JSON. The shape MUST NOT carry secrets, raw
 * keys, or anything sensitive: it's surfaced via the public job-
 * status endpoints.
 */
export interface JobExecutorContext {
    /**
     * Report mid-run progress. Called per meaningful boundary
     * (typically per batch / per phase). The callback awaits the
     * underlying transport (BullMQ -> Redis); executors should
     * `await` it so the GET status endpoint sees the latest value
     * immediately.
     */
    updateProgress?: (progress: unknown) => Promise<void>;
}

/**
 * A job executor function.
 *
 * Takes a typed payload and returns a `JobRunResult`.
 * Executors are responsible for:
 *   - Performing the job's business logic
 *   - Using `runJob()` for observability
 *   - Returning a consistent `JobRunResult`
 *   - NOT catching errors (let the registry handle fault isolation)
 *
 * The optional `ctx` argument carries worker-injected hooks (e.g.
 * BullMQ progress reporting). Executors that don't need it can
 * ignore it; entrypoints that don't supply it (cron, CLI) pass
 * nothing.
 */
export type JobExecutor<T extends JobName> = (
    payload: JobPayload<T>,
    ctx?: JobExecutorContext,
) => Promise<JobRunResult>;

// ─── Registry Implementation ────────────────────────────────────────

/**
 * Internal storage for registered executors.
 * Uses `Map` for O(1) lookup and safe iteration.
 */
/**
 * Storage type for the heterogeneous registry. A `Map` value cannot
 * preserve the per-job `JobExecutor<T>` relationship: function params
 * are contravariant, so a concrete `JobExecutor<'somejob'>` is NOT
 * assignable to `JobExecutor<JobName>` (it can't accept the full
 * payload union). We erase the payload to `never` on store — every
 * concrete `JobExecutor<T>` IS assignable to `JobExecutor<never>`
 * (a bottom param accepts any specific argument) — and re-narrow with
 * a cast on retrieval in `execute`, where the `name: T` argument makes
 * the `JobExecutor<T>` target sound.
 */
type StoredExecutor = JobExecutor<never>;
const executors = new Map<string, StoredExecutor>();

/**
 * The executor registry — singleton service.
 *
 * Thread-safe in Node.js (single-threaded). Registry mutations
 * (register) should only happen at module load time.
 */
export const executorRegistry = {
    /**
     * Register a job executor.
     *
     * @param name — job name (must match a key in JobPayloadMap)
     * @param executor — async function that processes the job
     * @throws if a duplicate registration is attempted
     */
    register<T extends JobName>(name: T, executor: JobExecutor<T>): void {
        if (executors.has(name)) {
            throw new Error(
                `Duplicate executor registration for job "${name}". ` +
                `Each job must have exactly one executor.`,
            );
        }
        executors.set(name, executor);
        logger.debug('executor registered', {
            component: 'executor-registry',
            jobName: name,
        });
    },

    /**
     * Execute a job by name with fault isolation.
     *
     * If the executor throws, the error is caught, logged, and
     * a failure `JobRunResult` is returned. One failing job
     * never crashes the scheduler or other jobs.
     *
     * @param name — job name
     * @param payload — typed payload
     * @param ctx — optional hooks (e.g. BullMQ progress callback)
     *   forwarded by the worker. Cron / CLI entrypoints leave this
     *   unset; executors that need progress must guard the calls.
     * @returns JobRunResult (always — never throws)
     */
    async execute<T extends JobName>(
        name: T,
        payload: JobPayload<T>,
        ctx?: JobExecutorContext,
    ): Promise<JobRunResult> {
        // Re-narrow the payload-erased StoredExecutor back to this job's
        // concrete executor — sound because `name: T` keys the lookup.
        const executor = executors.get(name) as JobExecutor<T> | undefined;
        const startedAt = new Date().toISOString();
        const startMs = performance.now();
        const jobRunId = crypto.randomUUID();

        if (!executor) {
            logger.error('no executor registered for job', {
                component: 'executor-registry',
                jobName: name,
            });
            return {
                jobName: name,
                jobRunId,
                success: false,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs: 0,
                itemsScanned: 0,
                itemsActioned: 0,
                itemsSkipped: 0,
                errorMessage: `No executor registered for job "${name}"`,
            };
        }

        try {
            const result = await executor(payload, ctx);
            // ── Record job success metric ──
            recordJobMetrics({
                jobName: name,
                success: result.success,
                durationMs: result.durationMs ?? Math.round(performance.now() - startMs),
            });
            return result;
        } catch (error) {
            const durationMs = Math.round(performance.now() - startMs);
            const errorMessage = error instanceof Error
                ? error.message
                : String(error);

            logger.error('job executor threw', {
                component: 'executor-registry',
                jobName: name,
                jobRunId,
                durationMs,
                error: errorMessage,
            });

            // ── Record job failure metric ──
            recordJobMetrics({ jobName: name, success: false, durationMs });

            const bypass = isNonRetryableJobError(error);
            if (bypass) {
                // Counted separately from the failure itself: "a job failed"
                // and "a job failed AND we declined to retry it" are different
                // operational facts, and a classifier bug shows up here as a
                // suppression rate that does not match the failure mix.
                recordQueueRetryBypass({ jobName: name, reason: error.reason });
            }

            // Every executor throw funnels through here, so this is the one
            // place that has to decide whether BullMQ should immediately re-run
            // the job. A revoked credential or a long throttle must not be
            // answered with three more attempts in 35 seconds — the thrower
            // says so with a `NonRetryableJobError`. The job still FAILS; only
            // the immediate retry is suppressed.
            return {
                jobName: name,
                jobRunId,
                success: false,
                startedAt,
                completedAt: new Date().toISOString(),
                durationMs,
                itemsScanned: 0,
                itemsActioned: 0,
                itemsSkipped: 0,
                errorMessage,
                ...(bypass ? { noRetry: true } : {}),
            };
        }
    },

    /**
     * Get the executor for a job name (or undefined).
     * Useful for the BullMQ worker to check registration before dispatch.
     */
    getExecutor<T extends JobName>(name: T): JobExecutor<T> | undefined {
        return executors.get(name) as JobExecutor<T> | undefined;
    },

    /**
     * Check if an executor is registered for a job name.
     */
    has(name: string): boolean {
        return executors.has(name);
    },

    /**
     * List all registered job names.
     */
    listRegistered(): string[] {
        return Array.from(executors.keys());
    },

    /**
     * Total number of registered executors.
     */
    get size(): number {
        return executors.size;
    },

    /**
     * Clear all registrations. **Test-only.**
     * @internal
     */
    _reset(): void {
        executors.clear();
    },
};

// ─── Default Registrations ──────────────────────────────────────────
//
// Each registration uses dynamic import so that heavy modules
// (Prisma, integration SDK, etc.) are only loaded when the job
// actually executes — not at registry import time.
// ─────────────────────────────────────────────────────────────────────

/**
 * Helper: create a normalized JobRunResult from a legacy job's
 * ad-hoc return shape. Jobs that already return JobRunResult
 * should be registered directly.
 */
function makeResult(
    jobName: string,
    startedAt: string,
    startMs: number,
    scanned: number,
    actioned: number,
    skipped: number,
    details?: Record<string, unknown>,
    outcome?: JobOutcome,
): JobRunResult {
    return {
        jobName,
        jobRunId: crypto.randomUUID(),
        success: outcome ? outcome.status !== 'ERROR' : true,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startMs),
        itemsScanned: scanned,
        itemsActioned: actioned,
        itemsSkipped: skipped,
        details,
        ...(outcome?.errorMessage && outcome.status === 'ERROR'
            ? { errorMessage: outcome.errorMessage }
            : {}),
        ...(outcome?.noRetry ? { noRetry: true } : {}),
    };
}

/**
 * The outcome a job reports back when it CATCHES its own failures instead of
 * throwing (a usecase that returns `status: 'ERROR'` in a result object).
 * Without it `makeResult` would record a job that failed completely as a
 * success, and job metrics, alerting and the BullMQ failed set would all read
 * clean. Only `ERROR` means the job itself broke; `PARTIAL` (work resumed by
 * the next run) and `FAILED` (a check that ran and found something) are
 * successful runs.
 */
interface JobOutcome {
    status: 'PASSED' | 'FAILED' | 'ERROR' | 'NOT_APPLICABLE' | 'SKIPPED' | 'PARTIAL';
    errorMessage?: string;
    noRetry?: boolean;
}

/**
 * The outcome of a fan-out sweep that isolates per-item failures (#5307).
 *
 * Isolation keeps one tenant's fault from stopping the others, but the run is
 * still not a clean one: any isolated failure makes it an ERROR, the shape
 * `snapshot` and `sla-monitor` already use (`success: errored === 0`).
 * `noRetry`, because the sweep already ran every item once and a BullMQ retry
 * would re-run the whole fan-out for the ones that succeeded; the next
 * scheduled tick is the retry.
 */
export function fanOutOutcome(
    jobName: string,
    failures: number,
    what: string,
): JobOutcome | undefined {
    if (failures === 0) return undefined;
    return {
        status: 'ERROR',
        errorMessage: `${jobName}: ${failures} ${what}`,
        noRetry: true,
    };
}

/** The outcome of a master-KEK rotation sweep (#5299). */
export function keyRotationOutcome(
    totalErrors: number,
    dekRewrapped: boolean,
    dekRewrapError: string | undefined,
): JobOutcome {
    if (totalErrors === 0 && dekRewrapped) return { status: 'PASSED' };
    const parts: string[] = [];
    if (!dekRewrapped) parts.push(`DEK not re-wrapped${dekRewrapError ? ` (${dekRewrapError})` : ''}`);
    if (totalErrors > 0) parts.push(`${totalErrors} error(s)`);
    return { status: 'ERROR', errorMessage: `key-rotation: ${parts.join('; ')}` };
}

// ── health-check ─────────────────────────────────────────────────────

executorRegistry.register('health-check', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    return makeResult('health-check', startedAt, startMs, 0, 0, 0, {
        enqueuedAt: payload.enqueuedAt,
        message: payload.message ?? 'pong',
        processedAt: new Date().toISOString(),
    });
});

// ── notification-outbox-flush ────────────────────────────────────────
//
// The outbox's own drain, every ten minutes, and the roadmap's sample job. See
// the module header for why a ten-minute cadence cannot double-send.
//
// `tenantId` and `limit` are NAMED rather than the payload spread: an absent
// tenantId is the platform-wide drain and a present one is an operator
// re-running a single tenant, and a payload forwarded opaquely is how a
// tenant-scoped run silently becomes an all-tenant send.

executorRegistry.register('notification-outbox-flush', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runNotificationOutboxFlush } = await import('./notification-outbox-flush');
    // `NamesEveryField` makes naming every payload field mandatory, so a field
    // added to the payload later fails `tsc` here until it is forwarded or
    // deliberately left out.
    const forwarded: NamesEveryField<typeof payload> = {
        tenantId: payload.tenantId,
        limit: payload.limit,
    };
    const r = await runNotificationOutboxFlush(forwarded);
    // `scanned` is every row this pass took responsibility for, `actioned` the
    // ones that left as mail. `skipped` covers both a tenant that has since
    // switched notifications off and a row another pass had already claimed —
    // neither is a failure, and counting either as one would make the ordinary
    // overlap of two ticks look like an incident.
    return makeResult(
        'notification-outbox-flush', startedAt, startMs,
        r.sent + r.failed + r.skipped, r.sent, r.skipped,
        { sent: r.sent, failed: r.failed, skipped: r.skipped },
    );
});

// ── audit-outbox-flush (sub-phase 1.5b) ──────────────────────────────
//
// When the hash chain cannot take an entry (an AUTHZ_DENIED under lock
// contention, say), `appendAuditEntryOrQueue` writes it to `AuditOutbox`
// instead, so the record is durable before the response. This is the
// out-of-band half that turns those rows back into chain entries.
//
// IT MUST BE SCHEDULED FOR THE FIX TO BE A FIX. A queued entry is durable but
// not yet evidence; without a drain the outbox is a table that only ever
// grows, and the denial still never reaches the trail. The cadence is five
// minutes because the failure it backs up is lock contention, which clears in
// seconds — the queue should be short-lived, not a parking lot.
//
// The payload's fields are NAMED rather than spread, for the same reason as
// the notification drain: a payload forwarded opaquely is how a tenant-scoped
// operator re-run silently becomes an all-tenant pass.

executorRegistry.register('audit-outbox-flush', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runAuditOutboxFlush } = await import('./audit-outbox-flush');
    const forwarded: NamesEveryField<typeof payload> = {
        tenantId: payload.tenantId,
        limit: payload.limit,
        maxAttempts: payload.maxAttempts,
    };
    const r = await runAuditOutboxFlush(forwarded);
    // `applied` is the only one that means an entry reached the chain.
    // `skipped` covers a row another pass had already claimed and a row whose
    // replay failed but has attempts left — neither is an incident, and
    // counting either as a failure would make ordinary overlap look like one.
    return makeResult(
        'audit-outbox-flush', startedAt, startMs,
        r.applied + r.failed + r.skipped, r.applied, r.skipped,
        { applied: r.applied, failed: r.failed, skipped: r.skipped },
    );
});

// ── key-rotation (sub-phase 1.5b) ────────────────────────────────────
//
// Enqueued by `POST /api/t/:slug/admin/key-rotation`, never scheduled: the
// operator starts it once per workspace after staging a new master key.

executorRegistry.register('key-rotation', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runKeyRotation } = await import('./key-rotation');
    const forwarded: NamesEveryField<typeof payload> = {
        tenantId: payload.tenantId,
        initiatedByUserId: payload.initiatedByUserId,
        requestId: payload.requestId,
    };
    const r = await runKeyRotation(forwarded);
    return makeResult(
        'key-rotation',
        startedAt,
        startMs,
        r.totalScanned,
        r.totalRewritten,
        0,
        {
            tenantId: r.tenantId,
            // Whose authority the run carried; who asked; why if not them.
            actor: r.actor,
            dekRewrapped: r.dekRewrapped,
            dekRewrapError: r.dekRewrapError,
            perField: r.perField,
            totalErrors: r.totalErrors,
            jobRunId: r.jobRunId,
        },
        // A sweep with errors — a DEK that failed to re-wrap, a row that
        // failed to re-encrypt — is a FAILED job, so the job history stops
        // reading green while the workspace still depends on the previous KEK
        // (#5299). It has one attempt (`JOB_DEFAULTS`): the operator reads the
        // failure and re-enqueues, which is safe because the sweep is
        // idempotent.
        keyRotationOutcome(r.totalErrors, r.dekRewrapped, r.dekRewrapError),
    );
});

// ── tenant-dek-rotation (sub-phase 1.5b) ─────────────────────────────
//
// Enqueued by `rotateTenantDek` after the DEK swap, never scheduled.

executorRegistry.register('tenant-dek-rotation', async (payload, ctx) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { runTenantDekRotation } = await import('./tenant-dek-rotation');
    const forwarded: NamesEveryField<typeof payload> = {
        tenantId: payload.tenantId,
        initiatedByUserId: payload.initiatedByUserId,
        requestId: payload.requestId,
        batchSize: payload.batchSize,
    };
    const r = await runTenantDekRotation({
        ...forwarded,
        // Forward the worker's progress callback so the
        // GET /admin/tenant-dek-rotation status endpoint sees live counters
        // mid-rotation, not just empty progress until the job completes.
        onProgress: ctx?.updateProgress,
    });
    return makeResult(
        'tenant-dek-rotation',
        startedAt,
        startMs,
        r.totalScanned,
        r.totalRewritten,
        r.totalSkipped,
        {
            tenantId: r.tenantId,
            actor: r.actor,
            previousEncryptedDekCleared: r.previousEncryptedDekCleared,
            perField: r.perField,
            totalErrors: r.totalErrors,
            jobRunId: r.jobRunId,
        },
        // Errors leave previousEncryptedDek set, which blocks every later
        // rotation; that is a failed job, not a green one (#5299). One
        // attempt: the operator investigates and re-enqueues.
        r.totalErrors > 0
            ? {
                  status: 'ERROR',
                  errorMessage: `tenant-dek-rotation: ${r.totalErrors} row(s) not re-encrypted; previous DEK kept`,
              }
            : { status: 'PASSED' },
    );
});

// ── Work items (sub-phase 2.2) ───────────────────────────────────────
//
// `tenantId` is NAMED rather than the payload spread: absent is the
// platform-wide sweep, present is an operator re-running one workspace.

executorRegistry.register('work-item-due-notification', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processWorkItemDueNotifications } = await import('./work-item-due-notification');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processWorkItemDueNotifications(forwarded);
    return makeResult(
        'work-item-due-notification', startedAt, startMs,
        r.itemsScanned, r.notificationsCreated, r.itemsScanned - r.notificationsCreated,
        { tenantsScanned: r.tenantsScanned },
    );
});

executorRegistry.register('work-item-purge', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processWorkItemPurge } = await import('./work-item-purge');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processWorkItemPurge(forwarded);
    return makeResult('work-item-purge', startedAt, startMs, r.items + r.projects, r.items + r.projects, 0, {
        tenants: r.tenants,
        items: r.items,
        projects: r.projects,
    });
});

executorRegistry.register('work-item-sortkey-rebalance', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processSortKeyRebalance } = await import('./work-item-sortkey-rebalance');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processSortKeyRebalance(forwarded);
    return makeResult('work-item-sortkey-rebalance', startedAt, startMs, r.items, r.items, 0, { projects: r.projects });
});

// ── Repeats (sub-phase 2.5d) ─────────────────────────────────────────

executorRegistry.register('work-item-recurrence', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processWorkItemRecurrence } = await import('./work-item-recurrence');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processWorkItemRecurrence(forwarded);
    return makeResult('work-item-recurrence', startedAt, startMs, r.tenants, r.tenants - r.failedTenants, r.failedTenants, {
        rules: r.rules,
        created: r.created,
        held: r.held,
        failed: r.failed,
        skippedOccurrences: r.skippedOccurrences,
    });
});

// ── Cycles (sub-phase 2.5a) ──────────────────────────────────────────

executorRegistry.register('cycle-rollover', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processCycleRollover } = await import('./cycle-rollover');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processCycleRollover(forwarded);
    return makeResult('cycle-rollover', startedAt, startMs, r.tenants, r.tenants - r.failedTenants, r.failedTenants, {
        teams: r.teams,
        cyclesCreated: r.cyclesCreated,
        cyclesClosed: r.cyclesClosed,
        itemsMoved: r.itemsMoved,
    });
});

// ── Intake (sub-phase 2.6a) ──────────────────────────────────────────

executorRegistry.register('intake-snooze-wake', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processIntakeSnoozeWake } = await import('./intake');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processIntakeSnoozeWake(forwarded);
    return makeResult('intake-snooze-wake', startedAt, startMs, r.tenants, r.tenants - r.failedTenants, r.failedTenants, { woken: r.count });
});

executorRegistry.register('intake-purge', async (payload) => {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();
    const { processIntakePurge } = await import('./intake');
    const forwarded: NamesEveryField<typeof payload> = { tenantId: payload.tenantId };
    const r = await processIntakePurge(forwarded);
    return makeResult('intake-purge', startedAt, startMs, r.tenants, r.tenants - r.failedTenants, r.failedTenants, { purged: r.count });
});
