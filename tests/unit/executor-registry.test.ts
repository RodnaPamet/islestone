/**
 * Unit coverage for the job executor registry.
 *
 * Exercises the registry's dispatch/lookup layer without running each
 * heavy executor body: registration (+ duplicate-throw), unknown-job
 * failure result, the catch/fault-isolation branch, the pure
 * `health-check` executor (which has no dynamic import), the
 * non-retryable path, and the lookup helpers (`getExecutor` / `has` /
 * `listRegistered` / `size` / `_reset`).
 *
 * Copied from inflect-compliance `tests/unit/executor-registry.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, over Islestone's two
 * registrations: the no-retry cases throw `NonRetryableJobError` (the
 * integration errors are 5.3's) and assert the bypass metric's reason; the
 * mocks of compliance job modules and their cases are not ported.
 */
import { executorRegistry } from '@/app-layer/jobs/executor-registry';
import { NonRetryableJobError } from '@/app-layer/jobs/non-retryable';
import type { JobRunResult } from '@/app-layer/jobs/types';
import { recordQueueRetryBypass } from '@/lib/observability/metrics';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/observability/metrics', () => ({
    recordJobMetrics: jest.fn(),
    recordQueueRetryBypass: jest.fn(),
}));

const mockBypass = recordQueueRetryBypass as jest.MockedFunction<typeof recordQueueRetryBypass>;

// Loosely-typed view so we can register/execute synthetic job names
// (the public API is generic over the closed `JobName` union).
const reg = executorRegistry as unknown as {
    register(name: string, fn: () => Promise<JobRunResult>): void;
    execute(name: string, payload: unknown): Promise<JobRunResult>;
    getExecutor(name: string): unknown;
    has(name: string): boolean;
    listRegistered(): string[];
    size: number;
    _reset(): void;
};

describe('executorRegistry — default registrations', () => {
    it('auto-registers exactly the built-in executors at import time', () => {
        expect(reg.listRegistered().sort()).toEqual([
            'audit-outbox-flush',
            'cycle-rollover',
            'health-check',
            'intake-purge',
            'intake-snooze-wake',
            'key-rotation',
            'notification-outbox-flush',
            'tenant-dek-rotation',
            'work-item-due-notification',
            'work-item-purge',
            'work-item-sortkey-rebalance',
        ]);
    });

    it('has() / getExecutor() resolve known + unknown names', () => {
        expect(reg.has('health-check')).toBe(true);
        expect(reg.has('definitely-not-a-job')).toBe(false);
        expect(reg.getExecutor('health-check')).toBeInstanceOf(Function);
        expect(reg.getExecutor('definitely-not-a-job')).toBeUndefined();
    });
});

describe('executorRegistry.execute — dispatch + fault isolation', () => {
    it('runs the pure health-check executor and defaults the message to "pong"', async () => {
        const enqueuedAt = new Date().toISOString();
        const result = await reg.execute('health-check', { enqueuedAt });
        expect(result.success).toBe(true);
        expect(result.jobName).toBe('health-check');
        expect(result.jobRunId).toBeTruthy();
        expect(result.details?.message).toBe('pong');
        expect(result.details?.enqueuedAt).toBe(enqueuedAt);
        expect(typeof result.durationMs).toBe('number');
    });

    it('passes through an explicit health-check message', async () => {
        const result = await reg.execute('health-check', {
            enqueuedAt: new Date().toISOString(),
            message: 'custom-ping',
        });
        expect(result.details?.message).toBe('custom-ping');
    });

    it('returns a failure result (not a throw) for an unknown job', async () => {
        const result = await reg.execute('totally-unknown-job', {});
        expect(result.success).toBe(false);
        expect(result.jobName).toBe('totally-unknown-job');
        expect(result.errorMessage).toMatch(/no executor registered/i);
        expect(result.durationMs).toBe(0);
        expect(result.itemsScanned).toBe(0);
    });

    it('catches an executor throw and returns a failure result', async () => {
        reg.register('unit-throwing-job', async () => {
            throw new Error('boom from executor');
        });
        const result = await reg.execute('unit-throwing-job', {});
        expect(result.success).toBe(false);
        expect(result.jobName).toBe('unit-throwing-job');
        expect(result.errorMessage).toBe('boom from executor');
        expect(typeof result.durationMs).toBe('number');
    });

    it('catches a non-Error throw and stringifies it', async () => {
        reg.register('unit-string-throw-job', async () => {
            throw 'plain string failure';
        });
        const result = await reg.execute('unit-string-throw-job', {});
        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe('plain string failure');
    });

    // ── Queue-retry suppression ──────────────────────────────────────────
    // This catch block is the single funnel for every executor throw, which
    // makes it the only place that can decide whether BullMQ re-runs the job.
    // Getting it wrong is invisible in the happy path and expensive in the
    // failure path: `attempts: 3` with 5s exponential backoff turns one
    // throttled sync into three full re-syncs inside ~35 seconds.

    it('flags a rate-limit failure as no-retry and counts it with its reason', async () => {
        reg.register('unit-throttled-job', async () => {
            throw new NonRetryableJobError('remote asked us to back off for 10 minutes', 'rate_limited');
        });
        const result = await reg.execute('unit-throttled-job', {});

        expect(result.success).toBe(false);
        // Still a recorded failure — the bypass suppresses the RETRY, not the
        // failure. A silently-succeeding throttle would be worse than the bug.
        expect(result.noRetry).toBe(true);
        expect(result.errorMessage).toBe('remote asked us to back off for 10 minutes');
        expect(mockBypass).toHaveBeenCalledWith({ jobName: 'unit-throttled-job', reason: 'rate_limited' });
    });

    it('flags a terminal failure (a revoked credential) as no-retry with reason terminal', async () => {
        reg.register('unit-revoked-job', async () => {
            throw new NonRetryableJobError('credential revoked', 'terminal');
        });
        const result = await reg.execute('unit-revoked-job', {});

        expect(result.success).toBe(false);
        expect(result.noRetry).toBe(true);
        expect(mockBypass).toHaveBeenCalledWith({ jobName: 'unit-revoked-job', reason: 'terminal' });
    });

    it('a subclass of NonRetryableJobError is non-retryable too (5.3 extends it)', async () => {
        class IntegrationTerminalError extends NonRetryableJobError {
            constructor() { super('terminal integration fault', 'terminal'); }
        }
        reg.register('unit-subclass-job', async () => {
            throw new IntegrationTerminalError();
        });
        const result = await reg.execute('unit-subclass-job', {});
        expect(result.noRetry).toBe(true);
    });

    it('leaves an ordinary failure retryable', async () => {
        // The bypass must stay narrow. A transient network fault is exactly
        // what the queue's retry is for, and marking everything no-retry would
        // trade an amplification bug for a durability one.
        reg.register('unit-transient-job', async () => {
            throw new TypeError('fetch failed');
        });
        const result = await reg.execute('unit-transient-job', {});

        expect(result.success).toBe(false);
        expect(result.noRetry).toBeUndefined();
        expect(mockBypass).not.toHaveBeenCalled();
    });
});

describe('executorRegistry.register — duplicate guard + reset', () => {
    it('throws on duplicate registration', () => {
        reg.register('unit-dupe-job', async () => ({
            jobName: 'unit-dupe-job',
            jobRunId: 'x',
            success: true,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            itemsScanned: 0,
            itemsActioned: 0,
            itemsSkipped: 0,
        }));
        expect(() =>
            reg.register('unit-dupe-job', async () => ({
                jobName: 'unit-dupe-job',
                jobRunId: 'y',
                success: true,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                durationMs: 0,
                itemsScanned: 0,
                itemsActioned: 0,
                itemsSkipped: 0,
            })),
        ).toThrow(/duplicate executor registration/i);
    });

    it('_reset() clears all registrations (test-only)', () => {
        expect(reg.size).toBeGreaterThan(0);
        reg._reset();
        expect(reg.size).toBe(0);
        expect(reg.listRegistered()).toEqual([]);
        expect(reg.has('health-check')).toBe(false);
    });
});
