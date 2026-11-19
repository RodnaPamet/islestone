/**
 * A job failure the queue must NOT immediately retry.
 *
 * The queue's default retry (attempts with backoff) is right for a transient
 * fault and harmful for two cases: a revoked credential, where every retry is
 * pure delay for the work queued behind it, and a rate limit, where retrying
 * inside a minute is exactly what the remote just asked us not to do. An
 * executor that meets one of these throws `NonRetryableJobError`; the executor
 * registry marks the run `noRetry` (the worker turns that into BullMQ's
 * `UnrecoverableError`) and counts it on `job.queue.retry_bypassed` with this
 * error's own `reason`. The job still FAILS and is still recorded; only the
 * immediate retry is suppressed.
 *
 * Written for Islestone in place of inflect-compliance's
 * `shouldBypassQueueRetry` (`src/app-layer/integrations/http-resilience.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e), so the registry imports no
 * integration code. Sub-phase 5.3's integration errors extend this class; a
 * third reason widens this union and the metric's together.
 */
export class NonRetryableJobError extends Error {
    constructor(
        message: string,
        readonly reason: 'terminal' | 'rate_limited',
    ) {
        super(message);
        this.name = 'NonRetryableJobError';
    }
}

/** Whether a thrown value is a `NonRetryableJobError` (or a subclass). */
export function isNonRetryableJobError(err: unknown): err is NonRetryableJobError {
    return err instanceof NonRetryableJobError;
}
