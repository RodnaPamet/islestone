/**
 * Baseline security headers: the ones that need no knowledge of the request.
 *
 * They stop MIME sniffing, framing (clickjacking), full-URL referrers to
 * other origins, and powerful browser features nobody has asked for. They are
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
