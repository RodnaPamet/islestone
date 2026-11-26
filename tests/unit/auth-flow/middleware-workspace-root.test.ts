/**
 * The workspace root, `/t/<slug>`, is redirected to My Work by the middleware
 * itself, after the tenant-access gate, with an empty body (Hardening H2f).
 * As a page (`redirect()` in `t/[tenantSlug]/(app)/page.tsx`) it was a 307
 * whose body streamed the workspace layout's shell with the signed-in
 * person's name and email: ZAP's Big Redirect rule (10044) flagged it when the
 * nightly scan, which now passes the public intake form through ZAP, reached
 * the workspace root.
 */
import { NextRequest } from 'next/server';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

import middleware from '@/middleware';
import { getToken } from 'next-auth/jwt';

const mockGetToken = getToken as jest.Mock;

function req(pathname: string) {
    return new NextRequest(`http://localhost:3000${pathname}`, { method: 'GET' });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue({
        sub: 'user-1',
        userId: 'user-1',
        role: 'OWNER',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        memberships: [{ slug: 'acme', role: 'OWNER', tenantId: 'tenant-1' }],
    });
});

describe('the workspace root', () => {
    it.each(['/t/acme', '/t/acme/'])('%s answers a bodyless 307 to My Work, with the baseline headers', async (path) => {
        const res = await middleware(req(path));
        expect(res.status).toBe(307);
        expect(new URL(res.headers.get('location')!).pathname).toBe('/t/acme/my-work');
        expect(await res.text()).toBe('');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('sends a workspace the session is not in to /no-tenant first, never to its My Work', async () => {
        const res = await middleware(req('/t/other'));
        expect(new URL(res.headers.get('location')!).pathname).toBe('/no-tenant');
    });

    it('leaves every other workspace page to the app', async () => {
        const res = await middleware(req('/t/acme/my-work'));
        expect(res.headers.get('location')).toBeNull();
        expect(res.status).toBe(200);
    });
});
