import { CONTENT_SECURITY_POLICY, securityHeaders } from '@/lib/security-headers';

const asMap = (production: boolean) =>
    Object.fromEntries(securityHeaders({ production }).map((h) => [h.key.toLowerCase(), h.value]));

describe('baseline security headers', () => {
    it('refuses sniffing, framing and full cross-origin referrers on every build', () => {
        for (const production of [false, true]) {
            const headers = asMap(production);
            expect(headers['x-content-type-options']).toBe('nosniff');
            expect(headers['x-frame-options']).toBe('DENY');
            expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
            expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
            expect(headers['permissions-policy']).toContain('camera=()');
        }
    });

    it('holds no script-src yet, which would need a per-request nonce (sub-phase 1.5)', () => {
        expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src|default-src/);
    });

    it('sends HSTS from a production build only', () => {
        expect(asMap(true)['strict-transport-security']).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
        expect(asMap(false)).not.toHaveProperty('strict-transport-security');
    });

    it('names each header once', () => {
        const keys = securityHeaders({ production: true }).map((h) => h.key.toLowerCase());
        expect(new Set(keys).size).toBe(keys.length);
    });
});
