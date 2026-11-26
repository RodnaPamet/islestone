/**
 * The middleware's per-request Content-Security-Policy (sub-phase 1.5):
 * every response carries one, its `script-src` nonce is fresh per request,
 * the same nonce reaches the render in the `x-csp-nonce` request header and
 * the whole policy in the request's Content-Security-Policy header (which is
 * what Next.js reads to stamp its own scripts), and `CSP_REPORT_ONLY` moves
 * it to the report-only header. A response the middleware answers itself (a
 * 401 here) carries the policy and the baseline headers too.
 *
 * Islestone-owned; the pattern is inflect-compliance's
 * `tests/guards/csp-request-header-bridge.test.ts`, which reads the source.
 */
import { NextRequest } from 'next/server';

jest.mock('next-auth/jwt', () => ({
    getToken: jest.fn().mockResolvedValue(null), // no session cookie
}));

import middleware, { config } from '@/middleware';

const req = (path: string) => new NextRequest(`http://localhost${path}`);

/** The nonce in a policy's script-src, or null. */
const nonceOf = (csp: string | null) => csp?.match(/script-src[^;]*'nonce-([A-Za-z0-9+/=]+)'/)?.[1] ?? null;

describe('middleware CSP', () => {
    const saved = process.env.CSP_REPORT_ONLY;
    afterEach(() => {
        if (saved === undefined) delete process.env.CSP_REPORT_ONLY;
        else process.env.CSP_REPORT_ONLY = saved;
    });

    it('sends a nonce policy on a public page, and passes the nonce and the policy to the render', async () => {
        const res = await middleware(req('/login'));
        const csp = res.headers.get('content-security-policy');
        const nonce = nonceOf(csp);
        expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
        expect(csp).toContain("'strict-dynamic'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("object-src 'none'");
        // NextResponse.next({ request: { headers } }) records the overrides.
        expect(res.headers.get('x-middleware-request-x-csp-nonce')).toBe(nonce);
        expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    });

    it('mints a different nonce for every request', async () => {
        const a = nonceOf((await middleware(req('/login'))).headers.get('content-security-policy'));
        const b = nonceOf((await middleware(req('/login'))).headers.get('content-security-policy'));
        expect(a).not.toBeNull();
        expect(a).not.toBe(b);
    });

    it('puts the policy and the baseline headers on a response it answers itself', async () => {
        const res = await middleware(req('/api/account/profile'));
        expect(res.status).toBe(401);
        expect(nonceOf(res.headers.get('content-security-policy'))).not.toBeNull();
        expect(res.headers.get('x-frame-options')).toBe('DENY');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        // Owner decision 246 (ZAP 90004): site isolation reaches the
        // middleware's own responses too, and COEP is deliberately absent.
        expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
        expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
        expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
    });

    // Hardening H1 (the ZAP baseline's 10038): these three are not files the
    // build serves, so Next.js answers them with the HTML not-found page; the
    // matcher once skipped them and that page went out with no policy.
    it('reaches favicon.ico, robots.txt and sitemap.xml, and gives each the nonce policy', async () => {
        const [pattern] = config.matcher;
        const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);
        for (const path of ['/favicon.ico', '/robots.txt', '/sitemap.xml']) {
            expect({ path, matched: matches(path) }).toEqual({ path, matched: true });
            const res = await middleware(req(path));
            expect({ path, status: res.status, location: res.headers.get('location') }).toEqual({ path, status: 200, location: null });
            expect(nonceOf(res.headers.get('content-security-policy'))).not.toBeNull();
            expect(res.headers.get('x-middleware-request-x-csp-nonce')).toBe(nonceOf(res.headers.get('content-security-policy')));
        }
        expect(matches('/_next/static/chunks/main.js')).toBe(false);
        expect(matches('/_next/image')).toBe(false);
    });

    it('sends it report-only when CSP_REPORT_ONLY is set', async () => {
        process.env.CSP_REPORT_ONLY = '1';
        const res = await middleware(req('/login'));
        expect(res.headers.get('content-security-policy')).toBeNull();
        expect(nonceOf(res.headers.get('content-security-policy-report-only'))).not.toBeNull();
    });
});
