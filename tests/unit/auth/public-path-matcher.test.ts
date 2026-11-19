/**
 * H1 — the public-path matcher.
 *
 * Copied from inflect-compliance `tests/unit/auth/public-path-matcher.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e. The parent's two dynamic
 * public API routes (the device report and the trust centre) are not ported,
 * so `PUBLIC_API_REGEXES` is empty here and the routes they matched are
 * PRIVATE: a request to them without a session is refused at the edge.
 */
import { isPublicPath, PUBLIC_API_REGEXES } from '@/lib/auth/guard';

describe('isPublicPath — dynamic public API routes (H1)', () => {
    it('carries no dynamic public API route', () => {
        expect(PUBLIC_API_REGEXES).toEqual([]);
    });

    it.each([
        // The parent's public routes, which Islestone did not take.
        '/api/t/acme/devices/report',
        '/api/trust/acme/access-request',
        '/api/trust/download/abcDEF123token',
        // Near-misses that were never public.
        '/api/t/acme/devices',
        '/api/t/acme/devices/report/extra',
        '/api/t/acme/work-items',
        '/api/t/acme/members',
        '/api/trust/',
    ])('does NOT treat %s as public', (p) => {
        expect(isPublicPath(p)).toBe(false);
    });

    it('still matches the prefix + exact allowlist', () => {
        expect(isPublicPath('/api/auth/session')).toBe(true);
        expect(isPublicPath('/login')).toBe(true);
        expect(isPublicPath('/invite/abc')).toBe(true);
        expect(isPublicPath('/api/livez')).toBe(true);
        expect(isPublicPath('/favicon.ico')).toBe(true);
        // Exact matches: the placeholder home page and the UI gallery, and
        // nothing under them.
        expect(isPublicPath('/')).toBe(true);
        expect(isPublicPath('/gallery')).toBe(true);
        expect(isPublicPath('/gallery/anything')).toBe(false);
        // A normal tenant API route stays private.
        expect(isPublicPath('/api/t/acme/admin/members')).toBe(false);
        // The workspace picker is behind the gate.
        expect(isPublicPath('/tenants')).toBe(false);
    });
});
