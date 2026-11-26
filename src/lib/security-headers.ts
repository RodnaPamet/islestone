/**
 * Baseline security headers: the ones that need no knowledge of the request.
 *
 * They stop MIME sniffing, framing (clickjacking), full-URL referrers to
 * other origins, powerful browser features nobody has asked for, and
 * cross-origin window and subresource access (site isolation). They are
 * sent on every response twice over: through `headers()` in next.config.ts
 * for everything Next.js serves, and by `src/middleware.ts` on the responses
 * the middleware answers itself (redirects, 401/403/429, CORS preflights),
 * which next.config.ts headers do not reach.
 *
 * The Content-Security-Policy is NOT here. Its `script-src` carries a nonce
 * that changes per request, so the middleware is its one writer
 * (`src/lib/security/csp.ts`, sub-phase 1.5); a second, static CSP here would
 * be a second policy the browser also enforces.
 *
 * Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy are both
 * `same-origin` (owner decision 246, ZAP 90004): a page Islestone serves
 * keeps no window reference to or from another origin's page, and no other
 * origin may embed Islestone's responses as images, scripts or other no-cors
 * subresources. Nothing Islestone serves is meant for another origin: its
 * pages load their own build assets, the Google and Microsoft sign-ins are
 * full-page redirects (no popup, no `window.opener`), and CORS requests are
 * not subject to CORP. Cross-Origin-Embedder-Policy is deliberately NOT sent:
 * `require-corp` would refuse every cross-origin image that carries no CORP
 * header, such as a Google or Microsoft avatar, so `.zap/rules.tsv` excuses
 * 90004 with that reason.
 *
 * Strict-Transport-Security goes out only from a production build. Browsers
 * ignore it over plain HTTP anyway, but a developer serving localhost over
 * HTTPS should not have the browser pin it for two years.
 */
export interface SecurityHeader {
    readonly key: string;
    readonly value: string;
}

/** Two years, the value the HSTS preload list asks for. Preloading itself is not requested. */
export const HSTS_MAX_AGE_SECONDS = 63_072_000;

export const PERMISSIONS_POLICY = [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'browsing-topics=()',
].join(', ');

export function securityHeaders({ production }: { readonly production: boolean }): SecurityHeader[] {
    const headers: SecurityHeader[] = [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];
    if (production) {
        headers.push({ key: 'Strict-Transport-Security', value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` });
    }
    return headers;
}

/** Set the baseline headers on a response the middleware answers itself. */
export function applySecurityHeaders(headers: Headers, production: boolean): void {
    for (const { key, value } of securityHeaders({ production })) headers.set(key, value);
}
