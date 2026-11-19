/**
 * Coverage for `src/app-layer/jobs/register-schedules.ts` (pure).
 *
 * A fake BullMQ Queue captures every `upsertJobScheduler` call so we
 * can assert the repeat-option shape branches:
 *   - every SCHEDULED_JOBS entry is registered (return = length).
 *   - `tz` is included when present (entry.tz OR entry.options.tz),
 *     omitted otherwise.
 *   - `limit` is included only when entry.options.limit is truthy.
 *   - optional logger is called per schedule when provided, and the
 *     no-logger path also works.
 *
 * The fake also models the scheduler SET (get/remove), because
 * `registerSchedules` no longer only upserts — it reconciles (#2497). The
 * reconciliation's own safety behaviour is guarded in
 * `tests/guards/scheduler-orphan-reconciliation.test.ts`; what this file
 * checks is that the upsert contract above is unchanged by it.
 *
 * Copied from inflect-compliance `tests/unit/jobs/register-schedules.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. Islestone has no
 * defined-but-unscheduled job, so the removable orphans are two test-only
 * retired names planted through `RETIRED_SCHEDULED_JOB_NAMES`; the last
 * describe pins Islestone's two infrastructure schedules instead of inflect's
 * risk crons.
 */
import type { Queue } from 'bullmq';

// Two retired names, so the sweep has something it is allowed to remove. The
// real list is empty (nothing has been retired), which would make every
// "removed" assertion here vacuous.
jest.mock('@/app-layer/jobs/schedules', () => ({
    ...jest.requireActual('@/app-layer/jobs/schedules'),
    RETIRED_SCHEDULED_JOB_NAMES: ['retired-test-job-a', 'retired-test-job-b'],
}));
import {
    registerSchedules,
    reconcileRetiredSchedulers,
} from '@/app-layer/jobs/register-schedules';
import { SCHEDULED_JOBS } from '@/app-layer/jobs/schedules';

interface CapturedCall {
    name: string;
    repeat: { pattern: string; tz?: string; limit?: number };
    template: { name: string; data: unknown };
}

/**
 * `preloaded` seeds scheduler ids that already exist in "Redis" before the
 * run — the only way to give the reconciliation a NON-EMPTY population, since
 * an empty scheduler set makes every sweep assertion vacuously true.
 */
function makeFakeQueue(preloaded: readonly string[] = []) {
    const calls: CapturedCall[] = [];
    const removed: string[] = [];
    const schedulers = new Set<string>(preloaded);
    const queue = {
        upsertJobScheduler: async (
            name: string,
            repeat: CapturedCall['repeat'],
            template: CapturedCall['template'],
        ) => {
            calls.push({ name, repeat, template });
            schedulers.add(name);
        },
        // BullMQ returns `key` (the scheduler id) alongside the template
        // `name`; the two are equal for every job this app registers, and the
        // reconciliation reads `key` because that is what removeJobScheduler
        // takes. The fake keeps them equal so a code path reading the wrong
        // field is caught by the guard file, not silently by this one.
        getJobSchedulers: async () =>
            [...schedulers].map((key) => ({ key, name: key })),
        removeJobScheduler: async (id: string) => {
            removed.push(id);
            return schedulers.delete(id);
        },
    } as unknown as Queue;
    return { calls, removed, schedulers, queue };
}

describe('registerSchedules', () => {
    it('registers every SCHEDULED_JOBS entry and returns the count', async () => {
        const { queue, calls } = makeFakeQueue();
        const count = await registerSchedules(queue);
        expect(count).toBe(SCHEDULED_JOBS.length);
        expect(calls).toHaveLength(SCHEDULED_JOBS.length);
        // Each call mirrors the entry name + pattern.
        for (const entry of SCHEDULED_JOBS) {
            const call = calls.find((c) => c.name === entry.name);
            expect(call).toBeDefined();
            expect(call?.repeat.pattern).toBe(entry.pattern);
            expect(call?.template.name).toBe(entry.name);
        }
    });

    it('includes tz only when the entry (or its options) carries one', async () => {
        const { queue, calls } = makeFakeQueue();
        await registerSchedules(queue);
        for (const entry of SCHEDULED_JOBS) {
            const tz = entry.tz ?? entry.options?.tz;
            const call = calls.find((c) => c.name === entry.name)!;
            if (tz) {
                expect(call.repeat.tz).toBe(tz);
            } else {
                expect(call.repeat).not.toHaveProperty('tz');
            }
        }
    });

    it('includes limit only when options.limit is truthy', async () => {
        const { queue, calls } = makeFakeQueue();
        await registerSchedules(queue);
        for (const entry of SCHEDULED_JOBS) {
            const call = calls.find((c) => c.name === entry.name)!;
            if (entry.options?.limit) {
                expect(call.repeat.limit).toBe(entry.options.limit);
            } else {
                expect(call.repeat).not.toHaveProperty('limit');
            }
        }
    });

    it('invokes the optional logger once per schedule', async () => {
        const { queue } = makeFakeQueue();
        const info = jest.fn();
        await registerSchedules(queue, { info });
        // Exactly the registrations: nothing is retired on a queue that holds
        // only the current schedule set, so the reconciliation logs nothing.
        expect(info).toHaveBeenCalledTimes(SCHEDULED_JOBS.length);
        // Each log call carries jobName + pattern.
        expect(info.mock.calls[0][0]).toHaveProperty('jobName');
        expect(info.mock.calls[0][1]).toBe('repeatable registered');
    });

    it('leaves every current schedule in place while reconciling', async () => {
        // Positive control for the assertion below: the queue starts with a
        // removable orphan, so "nothing was removed" cannot pass vacuously.
        const { queue, removed, schedulers } = makeFakeQueue(['retired-test-job-a']);
        await registerSchedules(queue);
        expect(removed).toEqual(['retired-test-job-a']);
        for (const entry of SCHEDULED_JOBS) {
            expect(schedulers.has(entry.name)).toBe(true);
        }
    });

    it('survives a logger with no warn/error channel', async () => {
        // `ScheduleRegLogger.warn`/`.error` are optional; a caller passing only
        // `info` (as the suite above does) must not crash the sweep.
        const { queue } = makeFakeQueue(['someone-elses-scheduler']);
        const info = jest.fn();
        await expect(registerSchedules(queue, { info })).resolves.toBe(
            SCHEDULED_JOBS.length,
        );
    });
});

describe('reconcileRetiredSchedulers — failure direction', () => {
    it('reports and returns 0 when the scheduler set cannot be enumerated', async () => {
        // getJobSchedulers throws on a legacy BullMQ repeatable key. The sweep
        // must fail OPEN (orphans survive) rather than propagate, because the
        // caller would otherwise report a registration failure that did not
        // happen.
        const error = jest.fn();
        const queue = {
            getJobSchedulers: async () => {
                throw new Error('legacy repeatable key');
            },
        } as unknown as Queue;
        await expect(
            reconcileRetiredSchedulers(queue, { info: jest.fn(), error }),
        ).resolves.toBe(0);
        expect(error).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][1]).toContain('left in place');
    });

    it('keeps sweeping after one removal fails, and does not count it', async () => {
        const error = jest.fn();
        // Two removable orphans; the first throws. A `removed` count of 1 with
        // both attempted is the proof the loop did not abort on the first.
        const attempted: string[] = [];
        const queue = {
            getJobSchedulers: async () => [
                { key: 'retired-test-job-a', name: 'retired-test-job-a' },
                { key: 'retired-test-job-b', name: 'retired-test-job-b' },
            ],
            removeJobScheduler: async (id: string) => {
                attempted.push(id);
                if (id === 'retired-test-job-a') throw new Error('redis down');
                return true;
            },
        } as unknown as Queue;
        await expect(
            reconcileRetiredSchedulers(queue, { info: jest.fn(), error }),
        ).resolves.toBe(1);
        expect(attempted).toEqual(['retired-test-job-a', 'retired-test-job-b']);
        expect(error).toHaveBeenCalledTimes(1);
    });
});

/**
 * The two infrastructure schedules must stay scheduled, and every other test
 * here iterates SCHEDULED_JOBS, so it is self-referential: remove an entry and
 * they all still pass, having verified a shorter array. Removing
 * `health-check` silences the worker heartbeat (a live worker then reads as
 * dead); removing `notification-outbox-flush` leaves the outbox with no
 * scheduled drain.
 */
describe('the infrastructure schedules stay scheduled', () => {
    it.each([
        ['health-check', '*/2 * * * *', 'drives the worker heartbeat'],
        ['notification-outbox-flush', '*/10 * * * *', "the outbox's only scheduled drain"],
    ])('%s is registered at %s — %s', (jobName, pattern) => {
        const entry = SCHEDULED_JOBS.find((j) => j.name === jobName);
        expect(entry?.pattern).toBe(pattern);
    });
});
