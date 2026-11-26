/**
 * The one way calendar sync talks to Google and Microsoft (roadmap 3.3b;
 * docs/porting/maps/3.3.md, "Egress, CSP and the sub-processor register").
 *
 * Every request goes to one of four FIXED origins (`CALENDAR_PROVIDER_ORIGINS`),
 * the pinned-host pattern of `src/lib/intake/email/resend-api.ts`: no person
 * configures a host, so a plain `fetch` with no redirects, a timeout and a
 * capped body read. The URL is checked against the list before the request,
 * so a path built from a provider's identifier can never point elsewhere.
 * No server-supplied URL is followed here: Graph's `@odata.nextLink` (the
 * read-back's, 3.3c) goes through `provider-next-link.ts`, `safeFetch` with its
 * origin pinned, and is read by the same `interpretProviderResponse`.
 *
 * Failures are classified here once: a token endpoint's `400` with a
 * credential code, and any 401 or 403, is `IntegrationAuthError` (terminal for
 * the connection); 429 is `IntegrationRateLimitedError`; a 5xx is
 * `ProviderHttpError`. Every other status is the caller's to read. Nothing of
 * a provider's body reaches an error message or a log line.
 *
 * Tests fake the providers at this seam (`tests/helpers/fake-calendar-provider.ts`
 * replaces the global `fetch`); `tests/guards/calendar-sync-egress.test.ts`
 * holds this as the only module of calendar sync that calls `fetch`.
 *
 * Server-only. Written fresh for Islestone.
 */
import { CREDENTIAL_ERROR_CODES, IntegrationAuthError, IntegrationRateLimitedError, ProviderHttpError } from '@/app-layer/integrations/http-errors';
import { readCappedBody } from '@/lib/intake/public/capped-body';

export const CALENDAR_PROVIDER_ORIGINS = [
    'https://oauth2.googleapis.com',
    'https://www.googleapis.com',
    'https://login.microsoftonline.com',
    'https://graph.microsoft.com',
] as const;

export const PROVIDER_TIMEOUT_MS = 15_000;
/** A calendar answer is small JSON; anything larger is refused. */
export const PROVIDER_JSON_MAX_BYTES = 2 * 1024 * 1024;

/** Whether `url` is on one of the fixed provider origins (https, no credentials, no port). */
export function providerUrlAllowed(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    return (CALENDAR_PROVIDER_ORIGINS as readonly string[]).includes(u.origin);
}

export interface ProviderResponse {
    status: number;
    ok: boolean;
    /** The parsed JSON body, or null for an empty or non-JSON one. */
    json: unknown;
}

export async function providerRequest(
    url: string,
    init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; body?: string | URLSearchParams },
    opts: { tokenEndpoint?: boolean } = {},
): Promise<ProviderResponse> {
    if (!providerUrlAllowed(url)) throw new Error('A calendar provider request was refused: the host is not one of the fixed provider origins.');
    const res = await fetch(url, {
        method: init.method,
        headers: { Accept: 'application/json', ...init.headers },
        body: init.body,
        redirect: 'error',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return interpretProviderResponse(res, opts);
}

/**
 * Read a provider's answer once: a capped body, parsed JSON, and the
 * classification every calendar call shares (a refused credential, a
 * throttle, a server error). Also the reader of a followed `nextLink`.
 */
export async function interpretProviderResponse(res: Response, opts: { tokenEndpoint?: boolean } = {}): Promise<ProviderResponse> {
    const text = res.status === 204 ? '' : await readCappedBody(res, PROVIDER_JSON_MAX_BYTES);
    let json: unknown = null;
    if (text) {
        try {
            json = JSON.parse(text) as unknown;
        } catch {
            json = null;
        }
    }
    if (opts.tokenEndpoint && res.status === 400) {
        const code = (json as { error?: unknown } | null)?.error;
        if (typeof code === 'string' && CREDENTIAL_ERROR_CODES.has(code)) throw new IntegrationAuthError(400, code);
    }
    // Google answers some throttles with 403 and a rate reason: a throttle,
    // never a revocation (revoking would disconnect the busiest members first).
    if (res.status === 403 && isGoogleRateReason(json)) throw new IntegrationRateLimitedError(null);
    if (res.status === 401 || res.status === 403) throw new IntegrationAuthError(res.status, null);
    if (res.status === 429) {
        const after = Number(res.headers.get('retry-after'));
        throw new IntegrationRateLimitedError(Number.isFinite(after) && after > 0 ? after : null);
    }
    if (res.status >= 500) throw new ProviderHttpError(res.status);
    return { status: res.status, ok: res.ok, json };
}

const GOOGLE_RATE_REASONS: ReadonlySet<string> = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

function isGoogleRateReason(json: unknown): boolean {
    const errors = (json as { error?: { errors?: unknown } } | null)?.error?.errors;
    if (!Array.isArray(errors)) return false;
    return errors.some((e) => typeof (e as { reason?: unknown })?.reason === 'string' && GOOGLE_RATE_REASONS.has((e as { reason: string }).reason));
}
