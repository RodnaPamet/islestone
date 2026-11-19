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

describe('/api/readyz', () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, BUILD_SHA: process.env.BUILD_SHA };
    beforeEach(() => {
        queryRaw.mockReset();
        redisClient = { ping: jest.fn().mockResolvedValue('PONG') };
        delete process.env.BUILD_SHA;
    });
    afterAll(() => {
        Object.assign(process.env, { NODE_ENV: saved.NODE_ENV });
        if (saved.BUILD_SHA === undefined) delete process.env.BUILD_SHA;
        else process.env.BUILD_SHA = saved.BUILD_SHA;
    });

    it('is 200 and ready when the database and Redis answer, never cached', async () => {
        queryRaw.mockResolvedValue([{ '?column?': 1 }]);
        const res = await readyz.GET();
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(readyz.dynamic).toBe('force-dynamic');
        const body = await res.json();
        expect(body).toMatchObject({
            status: 'ready',
            version: 'dev',
            failed: [],
            checks: { database: { status: 'ok' }, redis: { status: 'ok' } },
        });
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(redisClient?.ping).toHaveBeenCalledTimes(1);
    });

    it('reports the build it serves from BUILD_SHA', async () => {
        queryRaw.mockResolvedValue([]);
        process.env.BUILD_SHA = '0123abcd';
        await expect((await readyz.GET()).json()).resolves.toMatchObject({ version: '0123abcd' });
    });

    it('is 503 naming the database when the query fails, without the driver text', async () => {
        queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6432 user islestone_app'));
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        const text = await res.text();
        expect(JSON.parse(text)).toMatchObject({
            status: 'not_ready',
            failed: ['database'],
            checks: { database: { status: 'error', error: 'connection_failed' }, redis: { status: 'ok' } },
        });
        expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|islestone_app/);
    });

    it('is 503 naming Redis when the ping fails', async () => {
        queryRaw.mockResolvedValue([]);
        redisClient = { ping: jest.fn().mockRejectedValue(new Error('NOAUTH')) };
        const res = await readyz.GET();
        expect(res.status).toBe(503);
        await expect(res.json()).resolves.toMatchObject({
            failed: ['redis'],
            checks: { redis: { status: 'error', error: 'ping_failed' } },
        });
    });

    it('reports Redis as an error in production when REDIS_URL is unset (no client)', async () => {
        queryRaw.mockResolvedValue([]);
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
        queryRaw.mockResolvedValue([]);
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
