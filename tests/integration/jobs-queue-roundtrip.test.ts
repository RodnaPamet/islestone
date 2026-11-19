/**
 * The job queue end to end, against a real Redis and a real Postgres.
 *
 * `enqueue` puts a typed job on the BullMQ queue, a Worker on the same queue
 * name hands it to `executorRegistry.execute` (what `scripts/worker.ts` does),
 * and the result comes back through BullMQ. Two jobs, the two the registry
 * holds:
 *
 *   - `health-check`: the queue, the worker and the registry agree on the job
 *     name and the payload survives the trip;
 *   - `notification-outbox-flush`: the sample job drains a real outbox row to
 *     SENT through the provider, and a payload naming another workspace leaves
 *     this one's row alone (the named-payload rule in the registry).
 *
 * The unit suites (`tests/unit/jobs/bullmq-queue.test.ts`) mock BullMQ; this
 * one proves the pieces fit. It needs `REDIS_URL` (CI's Integration job runs a
 * Redis service) and fails closed without it, unless `ALLOW_REDIS_SKIP=1`,
 * which CI never sets — as `db-helper.ts` does for the database.
 *
 * Written for Islestone (sub-phase 1.6).
 */
import { Queue, QueueEvents, Worker, type ConnectionOptions, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

import { executorRegistry } from '@/app-layer/jobs/executor-registry';
import { closeQueue, enqueue, getQueue } from '@/app-layer/jobs/queue';
import { QUEUE_NAME, type JobName } from '@/app-layer/jobs/types';
import { disconnectRedis } from '@/lib/redis';
import { ConsoleEmailProvider, setEmailProvider, type EmailMessage } from '@/lib/mailer';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL && process.env.ALLOW_REDIS_SKIP !== '1') {
    throw new Error(
        '[jobs-queue-roundtrip] REDIS_URL is not set. This suite proves the queue against a real Redis; ' +
            'run `docker compose up -d` and set REDIS_URL, or set ALLOW_REDIS_SKIP=1 to skip it locally.',
    );
}

const describeFn = DB_AVAILABLE && REDIS_URL ? describe : describe.skip;

describeFn('the job queue, end to end (real Redis)', () => {
    const prisma = prismaTestClient();
    const SUITE = randomUUID().slice(0, 8);
    const T_MINE = `t-q-${SUITE}-mine`;
    const T_OTHER = `t-q-${SUITE}-other`;
    let connection: Redis;
    let worker: Worker;
    let events: QueueEvents;
    let eventsConnection: Redis;
    const sent: EmailMessage[] = [];

    beforeAll(async () => {
        await resetDatabase(prisma);
        for (const id of [T_MINE, T_OTHER]) {
            await prisma.tenant.create({ data: { id, name: id, slug: id } });
        }
        setEmailProvider({
            async send(msg: EmailMessage) {
                sent.push(msg);
            },
        });

        connection = new Redis(REDIS_URL!, { maxRetriesPerRequest: null });
        // Clear what an earlier run on this Redis left behind, so the worker
        // below does not pick up a stale job.
        const clean = new Queue(QUEUE_NAME, { connection: connection as ConnectionOptions });
        await clean.obliterate({ force: true });
        await clean.close();

        eventsConnection = new Redis(REDIS_URL!, { maxRetriesPerRequest: null });
        events = new QueueEvents(QUEUE_NAME, { connection: eventsConnection as ConnectionOptions });
        await events.waitUntilReady();
        worker = new Worker(
            QUEUE_NAME,
            async (job: Job) => executorRegistry.execute(job.name as JobName, job.data as never),
            { connection: connection as ConnectionOptions },
        );
        await worker.waitUntilReady();
    });

    afterAll(async () => {
        await worker?.close();
        await events?.close();
        await closeQueue();
        await disconnectRedis();
        await eventsConnection?.quit();
        await connection?.quit();
        setEmailProvider(new ConsoleEmailProvider());
        await resetDatabase(prisma);
    });

    it('health-check: enqueued, executed by the registry, result returned through BullMQ', async () => {
        const enqueuedAt = new Date().toISOString();
        const job = await enqueue('health-check', { enqueuedAt, message: `ping-${SUITE}` });
        const result = (await job.waitUntilFinished(events, 15_000)) as {
            jobName: string;
            success: boolean;
            details: Record<string, unknown>;
        };

        expect(result.jobName).toBe('health-check');
        expect(result.success).toBe(true);
        expect(result.details).toMatchObject({ enqueuedAt, message: `ping-${SUITE}` });
    });

    it('notification-outbox-flush: drains a real outbox row, and only the named workspace\'s', async () => {
        const mk = (tenantId: string, to: string) =>
            prisma.notificationOutbox.create({
                data: {
                    tenantId,
                    type: 'WORK_ITEM_ASSIGNED',
                    toEmail: to,
                    subject: 'Assigned',
                    bodyText: 'body',
                    dedupeKey: `dk-${randomUUID()}`,
                },
            });
        const mine = await mk(T_MINE, `mine-${SUITE}@example.test`);
        const theirs = await mk(T_OTHER, `theirs-${SUITE}@example.test`);

        const job = await enqueue('notification-outbox-flush', { tenantId: T_MINE, limit: 10 });
        const result = (await job.waitUntilFinished(events, 15_000)) as {
            success: boolean;
            details: { sent: number; failed: number };
        };

        expect(result.success).toBe(true);
        expect(result.details).toMatchObject({ sent: 1, failed: 0 });
        expect(sent.map((m) => m.to)).toEqual([`mine-${SUITE}@example.test`]);
        expect((await prisma.notificationOutbox.findUnique({ where: { id: mine.id } }))?.status).toBe('SENT');
        expect((await prisma.notificationOutbox.findUnique({ where: { id: theirs.id } }))?.status).toBe('PENDING');
    });

    it('closeQueue quits the queue\'s own Redis connection, not only the queue', async () => {
        // Counted by the connection's name on the server: the queue's
        // connection is `createRedisClient`'s, named islestone-worker.
        const appConnections = async () =>
            String(await connection.call('CLIENT', 'LIST'))
                .split('\n')
                .filter((line) => / name=islestone-worker /.test(line)).length;
        await getQueue().waitUntilReady();
        const before = await appConnections();
        expect(before).toBeGreaterThan(0);

        await closeQueue();

        // QUIT is acknowledged before the server drops the client; poll briefly.
        let after = before;
        for (let i = 0; i < 50 && after >= before; i++) {
            await new Promise((r) => setTimeout(r, 20));
            after = await appConnections();
        }
        expect(after).toBe(before - 1);
    });
});
