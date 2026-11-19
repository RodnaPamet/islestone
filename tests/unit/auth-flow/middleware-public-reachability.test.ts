/**
 * Middleware reachability — which API paths a request with NO session cookie
 * reaches, and which the edge refuses.
 *
 * Copied from inflect-compliance `tests/integration/middleware-public-reachability.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e and moved to the unit project
 * (it needs no database). The parent's subject was its three token/slug-authed
 * public routes (device report, trust centre); Islestone ports none of them,
 * so the cases assert the reverse — those paths are refused at the edge — and
 * that the public paths Islestone does have still reach their handlers. The
 * edge rate-limit case left with the edge limiter (sub-phase 1.5).
 */
import { NextRequest } from 'next/server';

jest.mock('next-auth/jwt', () => ({
    getToken: jest.fn().mockResolvedValue(null), // no session cookie
}));

import middleware from '@/middleware';

function req(method: string, pathname: string, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost:3000${pathname}`, { method, headers: new Headers(headers) });
}

describe('middleware reachability with no session cookie', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each([
        ['GET', '/api/livez'],
        ['GET', '/api/readyz'],
        ['GET', '/api/invites/sometoken123'],
        ['POST', '/api/invites/sometoken123/start-signin'],
        ['GET', '/api/org/invite/sometoken123'],
        ['GET', '/api/auth/session'],
        ['POST', '/api/auth/register'],
    ])('%s %s reaches the handler (not 401)', async (method, path) => {
        const res = await middleware(req(method, path), {} as never);
        expect(res.status).not.toBe(401);
    });

    it.each([
        ['POST', '/api/t/acme/devices/report', { authorization: 'Bearer icdt_testtoken123456' }],
        ['POST', '/api/trust/acme/access-request', {}],
        ['GET', '/api/trust/download/sometoken123', {}],
        ['GET', '/api/t/acme/admin/members', {}],
        ['GET', '/api/account/profile', {}],
    ])('%s %s is refused at the edge (401)', async (method, path, headers) => {
        const res = await middleware(req(method, path, headers), {} as never);
        expect(res.status).toBe(401);
    });
});
