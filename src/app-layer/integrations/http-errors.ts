/**
 * The two failures of an outside provider that concern the whole connection
 * rather than one request (roadmap 3.3b; ADR 0011).
 *
 * Copied in part from inflect-compliance `src/app-layer/integrations/http-resilience.ts`
 * and `oauth-token-fetch.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (BUSL-1.1): the two error classes and the RFC 6749 §5.2 credential codes
 * (`invalid_grant`, `invalid_client`, `unauthorized_client`), without
 * `resilientFetch` (5.x's). A withdrawn calendar consent is a `400
 * invalid_grant` on refresh, or a 401/403 on a call: both are terminal for the
 * connection. A throttle (429) never is.
 *
 * Messages carry the HTTP status and a code from a closed list, never a
 * provider body: an `error_description` can carry an address or a directory's
 * name.
 */

/** The RFC 6749 §5.2 codes that mean the credential is bad (not our request). */
export const CREDENTIAL_ERROR_CODES: ReadonlySet<string> = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);

export class IntegrationAuthError extends Error {
    constructor(
        readonly status: number,
        /** `invalid_grant` and its kin on a token endpoint, else null. */
        readonly code: string | null,
    ) {
        super(`The provider refused the credential (HTTP ${status}${code ? `, ${code}` : ''}).`);
        this.name = 'IntegrationAuthError';
    }
}

export class IntegrationRateLimitedError extends Error {
    constructor(readonly retryAfterSeconds: number | null) {
        super('The provider throttled the request (HTTP 429).');
        this.name = 'IntegrationRateLimitedError';
    }
}

/** Any other provider failure: the status only. */
export class ProviderHttpError extends Error {
    constructor(readonly status: number) {
        super(`The calendar provider answered HTTP ${status}.`);
        this.name = 'ProviderHttpError';
    }
}

/**
 * The connection's dedicated calendar is gone at the provider (roadmap 3.3c,
 * decision 232: "the whole Islestone calendar deleted"): an insert into it, or
 * a listing of it, answered 404. The connection moves to CALENDAR_REMOVED.
 */
export class CalendarGoneError extends Error {
    constructor() {
        super('The Islestone calendar no longer exists at the provider.');
        this.name = 'CalendarGoneError';
    }
}
