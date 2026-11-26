/**
 * Following a page link a calendar provider wrote (roadmap 3.3c;
 * docs/porting/maps/3.3.md, "Egress, CSP and the sub-processor register").
 *
 * Microsoft Graph pages `calendarView` by a full URL, `@odata.nextLink`, in its
 * answer: a server-supplied value, so it is never requested as written. It is
 * followed only when it is https on EXACTLY `https://graph.microsoft.com`
 * (no credentials, no port) under `/v1.0/`, and only through `safeFetch`
 * (private, loopback and metadata addresses refused, the DNS answer pinned, no
 * redirect), so a tampered answer cannot point the worker anywhere else. The
 * answer is read by `interpretProviderResponse`, the one classification every
 * calendar call shares. Google pages by token (`nextPageToken`), which
 * `reader.ts` puts into its own fixed-origin URL.
 *
 * An SSRF sink row in `tests/guards/ssrf-egress-coverage.test.ts`;
 * `tests/guards/calendar-sync-egress.test.ts` holds it as the only calendar
 * module that calls `safeFetch`.
 *
 * Server-only. Written fresh for Islestone.
 */
import { safeFetch } from '@/app-layer/automation/webhook-safety';

import { interpretProviderResponse, PROVIDER_TIMEOUT_MS, type ProviderResponse } from './provider-http';

export const GRAPH_NEXT_LINK_ORIGIN = 'https://graph.microsoft.com';

/** Whether a provider's page link may be followed: Graph's origin exactly, its v1.0 path. */
export function nextLinkAllowed(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return u.origin === GRAPH_NEXT_LINK_ORIGIN && u.pathname.startsWith('/v1.0/');
}

export class NextLinkRefusedError extends Error {
    constructor() {
        super('A calendar provider answered with a page link outside its own origin; the listing stops there.');
        this.name = 'NextLinkRefusedError';
    }
}

/** GET a Graph page link, pinned and through `safeFetch`. */
export async function followProviderNextLink(url: string, headers: Record<string, string>): Promise<ProviderResponse> {
    if (!nextLinkAllowed(url)) throw new NextLinkRefusedError();
    const res = await safeFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return interpretProviderResponse(res);
}
