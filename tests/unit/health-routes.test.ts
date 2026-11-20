/**
 * `/api/livez` and `/api/readyz` (sub-phase 1.8).
 *
 * Liveness checks nothing; readiness checks PostgreSQL and Redis through the
 * app's own clients, answers 503 naming what failed, never leaks a driver's
 * error text, and reports the build it serves. The checks themselves are
 * exercised against injected dependencies in the second half of this file.
 */
const queryRaw = jest.fn();
let redisClient: { ping: jest.Mock } | null = null;

jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));
jest.mock('@/lib/redis', () => ({ getRedis: () => redisClient }));

import * as livez from '@/app/api/livez/route';
import * as readyz from '@/app/api/readyz/route';
import { SEARCH_CONFIGURATION_FIXTURES } from '@/lib/search/configuration';
import { checkReadiness, type ReadinessDeps } from '@/lib/health/readiness';

describe('/api/livez', () => {
    it('answers 200 with {"status":"ok"} as JSON, never cached', async () => {
        const res = livez.GET();
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^application\/json/);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(livez.dynamic).toBe('force-dynamic');
        await expect(res.json()).resolves.toEqual({ status: 'ok' });
    });
});

/** The fixture read of `checkSearchConfiguration` (2.7f) names `tsvector_to_array`. */
const isFixtureRead = (query: unknown) => String((query as { sql?: string }).sql ?? '').includes('tsvector_to_array');
const STEMMED = SEARCH_CONFIGURATION_FIXTURES.map(([input, got]) => ({ input, got }));

/** `SELECT 1` answers `ping`; the fixture read answers the stems as pinned, or `stems`. */
function database(ping: unknown, stems: unknown = STEMMED) {
    queryRaw.mockImplementation(async (query: unknown) => {
        if (isFixtureRead(query)) {
            if (stems instanceof Error) throw stems;
            return stems;
        }
        if (ping instanceof Error) throw ping;
        return ping;
    });
}

describe('/api/readyz', () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, BUILD_SHA: process.env.BUILD_SHA };
    beforeEach(() => {
        queryRaw.mockReset();
        database([]);
        redisClient = { ping: jest.fn().mockResolvedValue('PONG') };
        delete process.env.BUILD_SHA;
    });
    afterAll(() => {
        Object.assign(process.env, { NODE_ENV: saved.NODE_ENV });
        if (saved.BUILD_SHA === undefined) delete process.env.BUILD_SHA;
        else process.env.BUILD_SHA = saved.BUILD_SHA;
    });

    it('is 200 and ready when the database and Redis answer, never cached', async () => {
        database([{ '?column?': 1 }]);
        const res = await readyz.GET();
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(readyz.dynamic).toBe('force-dynamic');
        const body = await res.json();
        expect(body).toMatchObject({
            status: 'ready',
            version: 'dev',
            failed: [],
            checks: { database: { status: 'ok' }, redis: { status: 'ok' }, search: { status: 'ok' } },
        });
        // `SELECT 1`, then the islestone_bg_en fixtures (2.7f).
        expect(queryRaw).toHaveBeenCalledTimes(2);
        expect(redisClient?.ping).toHaveBeenCalledTimes(1);
    });

    it('reports the build it serves from BUILD_SHA', async () => {
        database([]);
        process.env.BUILD_SHA = '0123abcd';
        await expect((await readyz.GET()).json()).resolves.toMatchObject({ version: '0123abcd' });
    });

    it('is 503 naming the database when the query fails, without the driver text', async () => {
        const refused = new Error('connect ECONNREFUSED 10.0.0.5:6432 user islestone_app');
        database(refused, refused);
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        const text = await res.text();
        expect(JSON.parse(text)).toMatchObject({
            status: 'not_ready',
            failed: ['database', 'search'],
            checks: { database: { status: 'error', error: 'connection_failed' }, redis: { status: 'ok' } },
        });
        expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|islestone_app/);
    });

    it('is 503 naming the search configuration when the Bulgarian dictionary is missing (2.7f)', async () => {
        database([], new Error('text search configuration "islestone_bg_en" does not exist'));
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        const text = await res.text();
        expect(JSON.parse(text)).toMatchObject({
            status: 'not_ready',
            failed: ['search'],
            checks: { database: { status: 'ok' }, search: { status: 'error', error: 'search_configuration' } },
        });
        expect(text).not.toMatch(/does not exist/);
    });

    it('is 503 when the dictionary stems otherwise than pinned, never a silent fallback (2.7f)', async () => {
        database([], STEMMED.map((r) => (r.input === 'задачата' ? { ...r, got: 'задачата' } : r)));
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toMatchObject({ failed: ['search'], checks: { search: { error: 'search_configuration' } } });
    });

    it('is 503 naming Redis when the ping fails', async () => {
        database([]);
        redisClient = { ping: jest.fn().mockRejectedValue(new Error('NOAUTH')) };
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toMatchObject({
            failed: ['redis'],
            checks: { redis: { status: 'error', error: 'ping_failed' } },
        });
    });

    it('reports Redis as an error in production when REDIS_URL is unset (no client)', async () => {
        database([]);
        redisClient = null;
        (process.env as Record<string, string>).NODE_ENV = 'production';
        try {
            const res = await readyz.GET();
            expect(res.status).toBe(503);
            await expect(res.json()).resolves.toMatchObject({
                checks: { redis: { status: 'error', error: 'not_configured' } },
            });
        } finally {
            (process.env as Record<string, string>).NODE_ENV = saved.NODE_ENV ?? 'test';
        }
    });

    it('skips Redis outside production when REDIS_URL is unset, and stays ready', async () => {
        database([]);
        redisClient = null;
        const res = await readyz.GET();
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toMatchObject({ checks: { redis: { status: 'skipped' } } });
    });
});

describe('checkReadiness', () => {
    const base: ReadinessDeps = {
        queryDatabase: async () => 1,
        pingRedis: async () => 'PONG',
        checkSearch: async () => true,
        production: true,
        version: 'v',
        timeoutMs: 50,
    };

    it('turns a hung dependency into `timeout` within the budget', async () => {
        const started = Date.now();
        const report = await checkReadiness({ ...base, queryDatabase: () => new Promise(() => undefined) });
        expect(Date.now() - started).toBeLessThan(1000);
        expect(report.checks.database).toMatchObject({ status: 'error', error: 'timeout' });
        expect(report.failed).toEqual(['database']);
    });

    it('treats a reply other than PONG as an error', async () => {
        const report = await checkReadiness({ ...base, pingRedis: async () => 'LOADING' });
        expect(report.checks.redis).toMatchObject({ status: 'error', error: 'unexpected_reply' });
        expect(report.status).toBe('not_ready');
    });

    it('names both when both fail', async () => {
        const report = await checkReadiness({
            ...base,
            queryDatabase: async () => {
                throw new Error('x');
            },
            pingRedis: async () => {
                throw new Error('y');
            },
        });
        expect(report.failed).toEqual(['database', 'redis']);
    });
});
