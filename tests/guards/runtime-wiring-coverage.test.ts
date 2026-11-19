/**
 * Runtime-wiring FORWARD-LOCK: every executor job is scheduled or explicitly
 * on-demand.
 *
 * Code that exists but is never reached in production is the silent-failure
 * class this guards: a job registered in `executor-registry.ts` that is
 * neither scheduled in `schedules.ts` nor enqueued by anything runs never, and
 * nothing says so. A NEW executor job that is neither scheduled nor listed in
 * `ON_DEMAND_JOBS` with a reason fails CI — catching a cron that was written
 * but never wired. A schedule with no executor (a dangling schedule) fails
 * too, and an on-demand reason of the form "dispatched by …" must name a real
 * `enqueue(` site.
 *
 * Copied from inflect-compliance `tests/guardrails/runtime-wiring-coverage.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, part (2) only: part (1), the
 * integration-bootstrap reachability, comes with the integration registry
 * (sub-phase 5.x). The two key rotations (sub-phase 1.5b) are the on-demand
 * jobs, and the detectors are proved against a planted registry and
 * schedule pair (an unwired executor, a dangling schedule, a reason naming no
 * enqueue site). Population from git (CLAUDE.md, "Guards").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { repoRelativeFiles } from '../helpers/repo-files';

const ROOT = path.resolve(__dirname, '../..');
// Comment-masked at the seam. Every harvest below must come from live code —
// a commented-out registration or a job name in prose vouches for nothing.
const read = (rel: string) => codeOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/**
 * Executor jobs that run on-demand rather than on a cron — dispatched by a
 * scheduled fan-out job, an API route, or an admin action. Each carries a
 * reason. A new executor job must be scheduled OR added here deliberately.
 * A reason that says "dispatched by" is checked: some `enqueue(` site in
 * `src/` must name the job.
 */
const ON_DEMAND_JOBS: Readonly<Record<string, string>> = {
    'key-rotation':
        'Admin-triggered once per workspace after a master-key change: dispatched by ' +
        'the key-rotation usecase behind POST /api/t/:slug/admin/key-rotation.',
    'tenant-dek-rotation':
        "OWNER-triggered after a suspected compromise: dispatched by rotateTenantDek, " +
        'which swaps the DEK and enqueues the sweep (POST /api/t/:slug/admin/tenant-dek-rotation).',
};

function registeredExecutorJobsIn(src: string): string[] {
    return [...src.matchAll(/executorRegistry\.register\('([a-z0-9-]+)'/g)].map((m) => m[1]!).sort();
}

function scheduledJobsIn(src: string): string[] {
    return [...src.matchAll(/name:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!).sort();
}

function unwiredOf(executors: string[], scheduled: Set<string>, onDemand: Readonly<Record<string, string>>): string[] {
    return executors.filter((j) => !scheduled.has(j) && !(j in onDemand));
}

function danglingOf(executors: string[], scheduled: Set<string>): string[] {
    const execSet = new Set(executors);
    return [...scheduled].filter((j) => !execSet.has(j));
}

function unenqueuedOf(onDemand: Readonly<Record<string, string>>, dispatchers: readonly string[]): string[] {
    const out: string[] = [];
    for (const [job, reason] of Object.entries(onDemand)) {
        if (!/dispatched by/i.test(reason)) continue;
        const named = new RegExp(`['"\`]${job.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
        if (!dispatchers.some((src) => named.test(src))) out.push(`${job} — reason claims "${reason}"`);
    }
    return out;
}

describe('Runtime wiring forward-lock — every executor job is scheduled or explicitly on-demand', () => {
    const executors = registeredExecutorJobsIn(read('src/app-layer/jobs/executor-registry.ts'));
    const scheduled = new Set(scheduledJobsIn(read('src/app-layer/jobs/schedules.ts')));

    it('sanity — executors + schedules parsed', () => {
        expect(executors).toEqual(expect.arrayContaining(['health-check', 'notification-outbox-flush']));
        expect(scheduled.size).toBeGreaterThanOrEqual(2);
    });

    it('no executor job is unwired — new jobs must be scheduled or marked on-demand', () => {
        expect(unwiredOf(executors, scheduled, ON_DEMAND_JOBS)).toEqual([]);
    });

    it('no scheduled job lacks an executor (dangling schedule)', () => {
        expect(danglingOf(executors, scheduled)).toEqual([]);
    });

    it('every "dispatched by" reason names a real enqueue site', () => {
        const dispatchers = repoRelativeFiles()
            .filter((f) => f.startsWith('src/') && f.endsWith('.ts'))
            .map((f) => codeOf(fs.readFileSync(path.join(ROOT, f), 'utf8')))
            .filter((src) => /\benqueue\(/.test(src));
        expect(unenqueuedOf(ON_DEMAND_JOBS, dispatchers)).toEqual([]);
    });

    it('no stale on-demand entries — every listed job still has an executor', () => {
        const execSet = new Set(executors);
        expect(Object.keys(ON_DEMAND_JOBS).filter((j) => !execSet.has(j))).toEqual([]);
    });
});

describe('the detectors catch planted miswiring (they are not vacuous)', () => {
    const registry = codeOf(`
        executorRegistry.register('health-check', async () => r);
        executorRegistry.register('planted-unwired', async () => r);
        // executorRegistry.register('commented-out', async () => r);
    `);
    const schedules = codeOf(`
        export const SCHEDULED_JOBS = [
            { name: 'health-check', pattern: '*/2 * * * *' },
            { name: 'planted-dangling', pattern: '0 3 * * *' },
        ];
    `);
    const executors = registeredExecutorJobsIn(registry);
    const scheduled = new Set(scheduledJobsIn(schedules));

    it('reads live registrations only (a commented-out one vouches for nothing)', () => {
        expect(executors).toEqual(['health-check', 'planted-unwired']);
    });

    it('flags an executor that is neither scheduled nor on-demand', () => {
        expect(unwiredOf(executors, scheduled, {})).toEqual(['planted-unwired']);
        expect(unwiredOf(executors, scheduled, { 'planted-unwired': 'admin action' })).toEqual([]);
    });

    it('flags a schedule with no executor', () => {
        expect(danglingOf(executors, scheduled)).toEqual(['planted-dangling']);
    });

    it('flags a "dispatched by" reason that no enqueue site backs', () => {
        const onDemand = { 'planted-unwired': 'dispatched by some-dispatcher' };
        expect(unenqueuedOf(onDemand, [codeOf("enqueue('other-job', {});")])).toHaveLength(1);
        expect(unenqueuedOf(onDemand, [codeOf("enqueue('planted-unwired', {});")])).toEqual([]);
    });
});
