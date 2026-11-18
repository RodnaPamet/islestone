/**
 * Baseline security headers, sent on every response through `headers()` in
 * next.config.ts.
 *
 * These are the headers that need no knowledge of the page: they stop MIME
 * sniffing, framing (clickjacking), full-URL referrers to other origins, and
 * powerful browser features nobody has asked for. A full Content-Security-Policy
 * with `script-src` needs a nonce per request and belongs to the security
 * perimeter (roadmap sub-phase 1.5); the policy here holds only the
 * directives that cannot break a page: `frame-ancestors`, `base-uri` and
 * `object-src`.
 *
 * Strict-Transport-Security goes out only from a production build. Browsers
 * ignore it over plain HTTP anyway, but a developer serving localhost over
 * HTTPS should not have the browser pin it for two years.
 */
export interface SecurityHeader {
    readonly key: string;
    readonly value: string;
}

export const CONTENT_SECURITY_POLICY = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

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
        { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    ];
    if (production) {
        headers.push({ key: 'Strict-Transport-Security', value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` });
    }
    return headers;
}
