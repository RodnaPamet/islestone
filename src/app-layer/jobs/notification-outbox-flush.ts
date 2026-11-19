/**
 * Notification outbox flush — the outbox's own scheduled drain.
 *
 * ## Why this job exists
 *
 * This is the roadmap's sample job (sub-phase 1.6): real, scheduled and
 * tested (`tests/unit/jobs/notification-outbox-flush-wiring.test.ts`).
 *
 * `processOutbox` is the last step of every email path in the product: the
 * due digest (`digest-dispatcher.ts`) and assignment mail (`enqueue.ts`).
 * Enqueuing a row is cheap and happens with the event that caused it;
 * DELIVERING it happens only when something calls this drain. This job is its
 * only scheduled caller; the other is the admin's per-tenant "Process Outbox"
 * action on the notification-settings API.
 *
 * In inflect-compliance the drain long lived at the tail of a daily evidence
 * job, so mail enqueued outside that minute waited up to a day, and a throw in
 * an unrelated sweep skipped it entirely. An operator could only close that gap
 * by already knowing the mail was stuck, which is the thing the mail was
 * supposed to tell them. Hence a schedule of its own.
 *
 * Copied from inflect-compliance `src/app-layer/jobs/notification-outbox-flush.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; code unchanged, comments
 * rewritten for Islestone.
 *
 * ## Why a short cadence is safe
 *
 * The outbox is durably idempotent per recipient: `NotificationOutbox` carries
 * a unique `dedupeKey`, and `processOutbox` CLAIMS each row with a conditional
 * `updateMany` predicated on `(status PENDING, attempts unchanged)` before it
 * sends. Two overlapping passes therefore cannot both send the same row — the
 * loser's claim matches zero rows and it moves on. So a ten-minute cadence
 * costs one indexed query per tick when there is nothing to do, and duplicates
 * nothing when there is.
 *
 * ## What this job deliberately does NOT do
 *
 * It does not enqueue anything. Every row it sends was written by whatever
 * subsystem decided a human needed telling. If this job finds an empty queue
 * that is a fact about the enqueuers, not a failure here — which is why an
 * empty pass returns zeros and succeeds rather than reporting a problem.
 *
 * @module app-layer/jobs/notification-outbox-flush
 */

import { processOutbox, type ProcessOutboxResult } from '../notifications/processOutbox';
import { runJob } from '@/lib/observability/job-runner';
import { logger } from '@/lib/observability/logger';

/**
 * Rows drained per pass when the caller names no limit.
 *
 * Bounded on purpose: one pass must not become an unbounded loop over a
 * backlog, because each row is an SMTP round trip and the worker's other jobs
 * queue behind it. At a ten-minute cadence this ceiling is 200 messages every
 * ten minutes — far above any volume this product generates, while still
 * capping the worst single pass. A backlog deeper than the ceiling drains
 * across consecutive ticks rather than in one long-running job.
 *
 * 200 rows per ten-minute tick caps one pass; a deeper backlog drains over
 * consecutive ticks.
 */
export const OUTBOX_FLUSH_LIMIT = 200;

export interface NotificationOutboxFlushOptions {
    /**
     * Restrict the drain to one tenant.
     *
     * Absent — which is what the schedule passes — drains every tenant, and
     * that is correct for a platform-level job. Any caller acting on behalf of
     * ONE tenant must pass it: `processOutbox` without a tenant sends every
     * other tenant's queued mail.
     */
    tenantId?: string;
    /** Override {@link OUTBOX_FLUSH_LIMIT} for an operator-driven catch-up run. */
    limit?: number;
}

/**
 * Drain the notification outbox once.
 *
 * Wrapped in `runJob` for the same reason every other job is: it is what puts
 * a jobRunId on the log lines, opens the trace span, and reports a failure to
 * Sentry. Without it a stuck outbox is invisible in exactly the way this job
 * exists to fix.
 */
export async function runNotificationOutboxFlush(
    options: NotificationOutboxFlushOptions = {},
): Promise<ProcessOutboxResult> {
    return runJob('notification-outbox-flush', async () => {
        const result = await processOutbox({
            limit: options.limit ?? OUTBOX_FLUSH_LIMIT,
            tenantId: options.tenantId,
        });

        logger.info('outbox flushed', {
            component: 'job',
            sent: result.sent,
            failed: result.failed,
            skipped: result.skipped,
            tenantId: options.tenantId,
        });

        return result;
    }, { tenantId: options.tenantId });
}
