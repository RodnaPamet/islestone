import { applySecurityHeaders, securityHeaders } from '@/lib/security-headers';

const asMap = (production: boolean) =>
    Object.fromEntries(securityHeaders({ production }).map((h) => [h.key.toLowerCase(), h.value]));

describe('baseline security headers', () => {
    it('refuses sniffing, framing and full cross-origin referrers on every build', () => {
        for (const production of [false, true]) {
            const headers = asMap(production);
            expect(headers['x-content-type-options']).toBe('nosniff');
            expect(headers['x-frame-options']).toBe('DENY');
            expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
            expect(headers['permissions-policy']).toContain('camera=()');
        }
    });

    // Owner decision 246 (ZAP 90004). `.zap/rules.tsv` excuses 90004 because
    // COEP alone is left out on purpose (require-corp would refuse cross-origin
    // avatars without CORP); ZAP's rules file cannot excuse one of the rule's
    // three headers only, so these assertions are what holds the other two.
    it('isolates the site: COOP and CORP same-origin on every build, and no COEP', () => {
        for (const production of [false, true]) {
            const headers = asMap(production);
            expect(headers['cross-origin-opener-policy']).toBe('same-origin');
            expect(headers['cross-origin-resource-policy']).toBe('same-origin');
            expect(headers).not.toHaveProperty('cross-origin-embedder-policy');
        }
    });

    it('carries no Content-Security-Policy: the middleware writes the one CSP, with a per-request nonce', () => {
        for (const production of [false, true]) {
            expect(asMap(production)).not.toHaveProperty('content-security-policy');
        }
    });

    it('sends HSTS from a production build only', () => {
        expect(asMap(true)['strict-transport-security']).toMatch(/^max-age=\d{8,}; includeSubDomains$/);
        expect(asMap(false)).not.toHaveProperty('strict-transport-security');
    });

    it('names each header once', () => {
        const keys = securityHeaders({ production: true }).map((h) => h.key.toLowerCase());
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('applySecurityHeaders sets exactly the same set on a Headers object', () => {
        const headers = new Headers();
        applySecurityHeaders(headers, true);
        expect(Object.fromEntries(headers.entries())).toEqual(asMap(true));
    });
});
