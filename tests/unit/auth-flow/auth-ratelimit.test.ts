/**
 * The auth rate-limit tier at the edge (`src/lib/rate-limit/authRateLimit.ts`,
 * wired into `src/middleware.ts` by sub-phase 1.5): a burst on an `/api/auth`
 * path is answered 429 by the middleware before NextAuth sees it, per client
 * IP, and nothing outside `/api/auth` is charged to it.
 *
 * Copied from inflect-compliance `tests/integration/auth-ratelimit.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, which sub-phase 1.4 left for
 * the edge limiter. It needs no database, so it lives in the unit project
 * beside the other middleware suites (tests/unit/auth-flow/). The parent mocked
 * NextAuth's `auth()` wrapper; Islestone's middleware reads the session with
 * `getToken`, mocked to "no cookie". Typed without `any`.
 */
import { NextRequest } from 'next/server';

jest.mock('next-auth/jwt', () => ({
    getToken: jest.fn().mockResolvedValue(null),
}));

import middleware from '@/middleware';

describe('auth rate-limit tier (middleware direct)', () => {
    const saved = {
        enabled: process.env.RATE_LIMIT_ENABLED,
        mode: process.env.RATE_LIMIT_MODE,
        testMode: process.env.AUTH_TEST_MODE,
    };
    beforeEach(() => {
        // Memory mode for determinism; RATE_LIMIT_ENABLED=1 because the
        // limiter otherwise stands down under NODE_ENV=test.
        process.env.RATE_LIMIT_ENABLED = '1';
        process.env.RATE_LIMIT_MODE = 'memory';
        // AUTH_TEST_MODE bypasses the tier.
        delete process.env.AUTH_TEST_MODE;
    });
    afterAll(() => {
        for (const [key, value] of [
            ['RATE_LIMIT_ENABLED', saved.enabled],
            ['RATE_LIMIT_MODE', saved.mode],
            ['AUTH_TEST_MODE', saved.testMode],
        ] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    function request(path: string, ip: string): NextRequest {
        const req = new NextRequest(`http://localhost${path}`);
        req.headers.set('x-forwarded-for', ip);
        return req;
    }

    it('answers 429 after the high-risk limit (10/min) on a sign-in path', async () => {
        const ip = '10.0.0.1';
        for (let i = 0; i < 10; i++) {
            const res = await middleware(request('/api/auth/signin', ip));
            expect(res.status).not.toBe(429);
        }
        const blocked = await middleware(request('/api/auth/signin', ip));
        expect(blocked.status).toBe(429);
        const data = (await blocked.json()) as { error: string; retryAfterSeconds?: number };
        expect(data.error).toBe('RATE_LIMITED');
        expect(data.retryAfterSeconds).toBeDefined();
        expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/);
        expect(blocked.headers.get('X-RateLimit-Limit')).toBe('10');
        // The middleware answered it, so it carries the baseline headers too.
        expect(blocked.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('does not charge a path outside /api/auth', async () => {
        const ip = '10.0.0.2';
        for (let i = 0; i < 70; i++) {
            const res = await middleware(request('/api/livez', ip));
            expect(res.status).not.toBe(429);
        }
    });

    it('keeps each client IP in its own bucket', async () => {
        const ipA = '10.0.0.3';
        const ipB = '10.0.0.4';
        for (let i = 0; i < 11; i++) {
            await middleware(request('/api/auth/callback/google', ipA));
        }
        expect((await middleware(request('/api/auth/callback/google', ipA))).status).toBe(429);
        expect((await middleware(request('/api/auth/callback/google', ipB))).status).not.toBe(429);
    });
});
