/**
 * Connection Pooling Integration Test
 *
 * Validates that the database connection can handle high concurrency
 * by running 60+ parallel queries simultaneously on a client built the
 * way the app builds its own (`TENANT_TX_OPTIONS`). When PgBouncer is
 * configured correctly, this completes without connection exhaustion.
 *
 * It connects to the integration database URL (`DB_URL`). In CI that URL
 * points at PgBouncer in transaction mode in front of the test database,
 * as `DATABASE_URL` does in development and production; with a direct
 * Postgres URL it tests the direct pool instead.
 *
 * Gated like every other integration suite: an unreachable database fails
 * the run (see db-helper.ts) unless ALLOW_DB_SKIP=1 asks for a skip.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { TENANT_TX_OPTIONS } from '@/lib/db/concurrency-limits';

import { DB_AVAILABLE, DB_URL } from './db-helper';

const CONCURRENCY_LEVEL = 60;

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('Connection pooling: concurrent query handling', () => {
    let prisma: PrismaClient;

    beforeAll(() => {
        prisma = new PrismaClient({
            adapter: new PrismaPg({ connectionString: DB_URL }),
            transactionOptions: TENANT_TX_OPTIONS,
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    test(`handles ${CONCURRENCY_LEVEL} concurrent queries without connection exhaustion`, async () => {
        const queries = Array.from({ length: CONCURRENCY_LEVEL }, (_, i) =>
            prisma
                .$queryRawUnsafe<[{ result: number }]>(`SELECT ${i + 1} as result`)
                .then((rows) => ({ index: i, result: Number(rows[0]?.result), error: null as string | null }))
                .catch((err: unknown) => ({ index: i, result: -1, error: (err as Error).message })),
        );

        const results = await Promise.all(queries);

        // Named in the failure message rather than logged.
        expect(results.filter((r) => r.error !== null).slice(0, 5)).toEqual([]);
        for (const result of results) {
            expect(result.result).toBe(result.index + 1);
        }
    }, 30_000);

    test('sequential queries work after concurrent burst', async () => {
        const result = await prisma.$queryRawUnsafe<[{ one: number }]>('SELECT 1 as one');
        expect(Number(result[0]?.one)).toBe(1);
    });
});
