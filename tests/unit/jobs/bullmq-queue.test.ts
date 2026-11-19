/**
 * BullMQ Queue — Contract Tests
 *
 * Validates job names, payload contracts, queue option defaults, and worker
 * processing behaviour WITHOUT requiring a live Redis instance.
 *
 * Architecture note: BullMQ v5 relies on Lua scripts that are incompatible with
 * in-process Redis mocks. These tests mock the BullMQ layer itself, keeping
 * infrastructure out of the unit/integration contract assertions.
 *
 * Copied from inflect-compliance `tests/integration/bullmq-queue.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e into `tests/unit/jobs/` (it needs
 * no database or Redis), over Islestone's two jobs.
 */
import { QUEUE_NAME, JOB_DEFAULTS } from '../../../src/app-layer/jobs/types';
import type {
    HealthCheckPayload,
    JobPayloadMap,
    NotificationOutboxFlushPayload,
} from '../../../src/app-layer/jobs/types';

// ─── In-memory Queue Mock ─────────────────────────────────────────────────────

interface MockJob<T = unknown> {
    id: string;
    name: string;
    data: T;
    opts: Record<string, unknown>;
    returnvalue?: unknown;
    _state: 'waiting' | 'completed' | 'failed';
    failedReason?: string;
}

let _nextId = 1;

class MockQueue {
    readonly name: string;
    private jobs: MockJob[] = [];

    constructor(name: string) {
        this.name = name;
    }

    async add<T>(name: string, data: T, opts: Record<string, unknown> = {}): Promise<MockJob<T>> {
        const job: MockJob<T> = {
            id: String(_nextId++),
            name,
            data,
            opts,
            _state: 'waiting',
        };
        this.jobs.push(job as MockJob);
        return job;
    }

    async getJob(id: string): Promise<MockJob | undefined> {
        return this.jobs.find(j => j.id === id);
    }

    async getJobs(types: string[]): Promise<MockJob[]> {
        return this.jobs.filter(j => types.includes(j._state));
    }

    async close(): Promise<void> { /* noop */ }
    async obliterate(): Promise<void> { this.jobs = []; }

    _processJob(id: string, result: unknown): void {
        const job = this.jobs.find(j => j.id === id);
        if (job) { job._state = 'completed'; job.returnvalue = result; }
    }
}

class MockWorker {
    readonly queueName: string;
    private handler: (job: MockJob) => Promise<unknown>;

    constructor(queueName: string, handler: (job: MockJob) => Promise<unknown>) {
        this.queueName = queueName;
        this.handler = handler;
    }

    async process(job: MockJob): Promise<unknown> {
        return this.handler(job);
    }

    async close(): Promise<void> { /* noop */ }
    async waitUntilReady(): Promise<void> { /* noop */ }
}

// Getters, so the classes above are read when a test touches them: the
// transformer hoists `jest.mock` above the class declarations.
jest.mock('bullmq', () => ({
    get Queue() { return MockQueue; },
    get Worker() { return MockWorker; },
    Job: class {},
    QueueEvents: class { on() {} close() {} },
}));

// ─── Re-import after mock ─────────────────────────────────────────────────────
import { Queue, Worker } from 'bullmq';

// ─────────────────────────────────────────────────────────────────────────────

describe('BullMQ Queue — Constants', () => {
    test('QUEUE_NAME is a non-empty string', () => {
        expect(typeof QUEUE_NAME).toBe('string');
        expect(QUEUE_NAME.length).toBeGreaterThan(0);
    });

    test('JOB_DEFAULTS covers all job names', () => {
        const expectedJobs: Array<keyof JobPayloadMap> = [
            'health-check',
            'notification-outbox-flush',
        ];
        for (const name of expectedJobs) {
            expect(JOB_DEFAULTS[name]).toBeDefined();
            expect(JOB_DEFAULTS[name].attempts).toBeGreaterThan(0);
            expect(JOB_DEFAULTS[name].backoff).toMatchObject({ type: expect.any(String), delay: expect.any(Number) });
        }
    });
});

describe('BullMQ Queue — Enqueue contract', () => {
    let queue: InstanceType<typeof MockQueue>;

    beforeEach(() => {
        queue = new (Queue as unknown as typeof MockQueue)(QUEUE_NAME);
    });

    afterEach(async () => {
        await (queue as MockQueue).obliterate();
        await queue.close();
    });

    test('enqueue creates a job with correct name and data', async () => {
        const payload: HealthCheckPayload = { enqueuedAt: new Date().toISOString(), message: 'test' };
        const job = await queue.add('health-check', payload, JOB_DEFAULTS['health-check'] as never);

        expect(job.id).toBeDefined();
        expect(job.name).toBe('health-check');
        expect(job.data).toEqual(payload);
    });

    test('job defaults are applied correctly', async () => {
        const job = await queue.add('health-check', { enqueuedAt: new Date().toISOString() }, JOB_DEFAULTS['health-check'] as never);

        expect((job.opts as typeof JOB_DEFAULTS['health-check']).attempts).toBe(JOB_DEFAULTS['health-check'].attempts);
        expect((job.opts as typeof JOB_DEFAULTS['health-check']).backoff).toEqual(JOB_DEFAULTS['health-check'].backoff);
    });

    test('multiple job types can coexist in the queue', async () => {
        const j1 = await queue.add('health-check', { enqueuedAt: new Date().toISOString() });
        const j2 = await queue.add('notification-outbox-flush', { tenantId: 'tenant-1' });

        expect(j1.name).toBe('health-check');
        expect(j2.name).toBe('notification-outbox-flush');
        expect(j1.id).not.toBe(j2.id);
    });

    test('getJob retrieves an enqueued job by id', async () => {
        const payload: HealthCheckPayload = { enqueuedAt: new Date().toISOString(), message: 'get-test' };
        const job = await queue.add('health-check', payload);

        const fetched = await queue.getJob(job.id);
        expect(fetched).toBeDefined();
        expect(fetched!.data).toMatchObject({ message: 'get-test' });
    });

    test('notification-outbox-flush payload contract is satisfied', async () => {
        // Absent tenantId is the scheduled all-workspace drain; present narrows
        // it to one workspace (the admin's manual drain).
        const scoped: NotificationOutboxFlushPayload = { tenantId: 'tenant-1', limit: 50 };
        const scheduled: NotificationOutboxFlushPayload = {};

        const job = await queue.add('notification-outbox-flush', scoped, JOB_DEFAULTS['notification-outbox-flush'] as never);
        const tick = await queue.add('notification-outbox-flush', scheduled, JOB_DEFAULTS['notification-outbox-flush'] as never);
        expect(job.data).toEqual({ tenantId: 'tenant-1', limit: 50 });
        expect(tick.data).toEqual({});
        expect((job.opts as typeof JOB_DEFAULTS['notification-outbox-flush']).attempts).toBe(1);
    });
});

describe('BullMQ Worker — Round-trip contract', () => {
    test('worker receives and processes an enqueued job', async () => {
        const queue = new (Queue as unknown as typeof MockQueue)(QUEUE_NAME);

        const processed: unknown[] = [];
        const worker = new (Worker as unknown as typeof MockWorker)(
            QUEUE_NAME,
            async (job: MockJob) => {
                processed.push(job.data);
                return { status: 'ok', message: (job.data as HealthCheckPayload).message };
            },
        );

        await worker.waitUntilReady();

        const payload: HealthCheckPayload = { enqueuedAt: new Date().toISOString(), message: 'round-trip' };
        const job = await queue.add('health-check', payload);

        // Simulate worker picking up and processing the job
        const result = await (worker as MockWorker).process(job as unknown as MockJob);

        expect(processed).toHaveLength(1);
        expect(processed[0]).toMatchObject({ message: 'round-trip' });
        expect(result).toMatchObject({ status: 'ok', message: 'round-trip' });

        await worker.close();
        await queue.close();
    });
});
