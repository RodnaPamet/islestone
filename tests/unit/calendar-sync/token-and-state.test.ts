/**
 * Calendar sync's OAuth pieces (roadmap 3.3b; ADR 0011 §6; decisions 228,
 * 236, 237): the authorize URLs (PKCE S256, the calendar scope alone, never
 * openid/email/profile, no include_granted_scopes, Microsoft's authority the
 * consented directory), the admin-consent URL, the code exchange with the
 * verifier, the refresh asking the same scopes and keeping the refresh token
 * Google does not rotate, the failures classified (a refused credential is
 * terminal, a throttle is not), every request on a fixed origin, and the
 * sealed state (tampering, age, purpose, the returned state).
 *
 * The providers are faked at the fetch seam: no request leaves the process.
 */
import { createHash } from 'node:crypto';

import { IntegrationAuthError, IntegrationRateLimitedError, ProviderHttpError } from '@/app-layer/integrations/http-errors';
import { providerRequest, providerUrlAllowed } from '@/app-layer/integrations/providers/calendar/provider-http';
import {
    GOOGLE_CALENDAR_SCOPES,
    MICROSOFT_CALENDAR_SCOPES,
    MissingRefreshTokenError,
    buildCalendarAuthorizeUrl,
    buildMicrosoftAdminConsentUrl,
    exchangeCalendarCode,
    parseCalendarToken,
    refreshCalendarToken,
    resolveCalendarAccessToken,
} from '@/app-layer/integrations/providers/calendar/token';
import { googleEventBody, graphEventBody } from '@/app-layer/integrations/providers/calendar/writer';
import { newOAuthSecrets, sealOAuthState, stateMatches, unsealOAuthState, STATE_MAX_AGE_MS } from '@/lib/calendar-sync/oauth-state';
import { checkProductionCalendarSync } from '@/lib/security/startup-calendar-sync-check';

const DIRECTORY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const realFetch = global.fetch;
let calls: Array<{ url: string; init: RequestInit }>;

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        return respond(url, init ?? {});
    }) as typeof fetch;
}

beforeEach(() => {
    calls = [];
    process.env.GOOGLE_CLIENT_ID = 'g-client';
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret'; // pragma: allowlist secret
    process.env.MICROSOFT_CLIENT_ID = 'm-client';
    process.env.MICROSOFT_CLIENT_SECRET = 'm-secret'; // pragma: allowlist secret
});
afterEach(() => {
    global.fetch = realFetch;
});

describe('the authorize URLs', () => {
    it('Google: the calendar.app.created scope alone, PKCE S256, offline with consent, and no include_granted_scopes', () => {
        const url = new URL(buildCalendarAuthorizeUrl({ provider: 'GOOGLE', redirectUri: 'https://isl.test/api/integrations/calendar/callback', state: 's', codeChallenge: 'chal' }));
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
        expect(url.searchParams.get('code_challenge')).toBe('chal');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('prompt')).toBe('consent');
        expect(url.searchParams.has('include_granted_scopes')).toBe(false);
        expect(url.searchParams.get('client_id')).toBe('g-client');
    });

    it('Microsoft: offline_access Calendars.ReadWrite at the consented directory, no prompt; refused before consent', () => {
        const url = new URL(buildCalendarAuthorizeUrl({ provider: 'MICROSOFT', redirectUri: 'https://isl.test/cb', state: 's', codeChallenge: 'c', microsoftDirectoryId: DIRECTORY }));
        expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${DIRECTORY}/oauth2/v2.0/authorize`);
        expect(url.searchParams.get('scope')).toBe('offline_access Calendars.ReadWrite');
        expect(url.searchParams.has('prompt')).toBe(false);
        expect(() => buildCalendarAuthorizeUrl({ provider: 'MICROSOFT', redirectUri: 'x', state: 's', codeChallenge: 'c' })).toThrow();
        expect(() => buildCalendarAuthorizeUrl({ provider: 'MICROSOFT', redirectUri: 'x', state: 's', codeChallenge: 'c', microsoftDirectoryId: 'evil.example/x' })).toThrow();
    });

    it('never asks openid, email or profile (decision 236)', () => {
        for (const s of [...GOOGLE_CALENDAR_SCOPES, ...MICROSOFT_CALENDAR_SCOPES]) expect(['openid', 'email', 'profile']).not.toContain(s);
    });

    it('the admin consent: the v2 endpoint with the calendar scope named, at organizations', () => {
        const url = new URL(buildMicrosoftAdminConsentUrl({ redirectUri: 'https://isl.test/api/integrations/calendar/admin-callback', state: 'n' }));
        expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent');
        expect(url.searchParams.get('scope')).toBe('https://graph.microsoft.com/Calendars.ReadWrite');
        expect(url.searchParams.get('state')).toBe('n');
    });
});

describe('the token calls', () => {
    it('exchanges the code with the verifier and records the granted scopes', async () => {
        fakeFetch(() => answer(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.app.created' }));
        const r = await exchangeCalendarCode({ provider: 'GOOGLE', code: 'code', codeVerifier: 'v'.repeat(64), redirectUri: 'https://isl.test/cb', now: 1_000_000 });
        expect(r.token).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 + 3600 });
        expect(r.scopesGranted).toEqual(['https://www.googleapis.com/auth/calendar.app.created']);
        const body = new URLSearchParams(String(calls[0]!.init.body));
        expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
        expect(body.get('code_verifier')).toBe('v'.repeat(64));
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(calls[0]!.init.redirect).toBe('error');
    });

    it('refuses a consent without a refresh token', async () => {
        fakeFetch(() => answer(200, { access_token: 'at', expires_in: 3600 }));
        await expect(exchangeCalendarCode({ provider: 'GOOGLE', code: 'c', codeVerifier: 'v'.repeat(64), redirectUri: 'x' })).rejects.toBeInstanceOf(MissingRefreshTokenError);
    });

    it('refreshes with the same scopes, keeps a refresh token Google does not rotate, takes one Microsoft rotates', async () => {
        fakeFetch(() => answer(200, { access_token: 'at2', expires_in: 60 }));
        const g = await refreshCalendarToken({ provider: 'GOOGLE', refreshToken: 'rt1' });
        expect(g.refreshToken).toBe('rt1');
        expect(new URLSearchParams(String(calls[0]!.init.body)).get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
        fakeFetch(() => answer(200, { access_token: 'at3', refresh_token: 'rt2', expires_in: 60 }));
        const m = await refreshCalendarToken({ provider: 'MICROSOFT', refreshToken: 'rt1', microsoftDirectoryId: DIRECTORY });
        expect(m.refreshToken).toBe('rt2');
        expect(calls[1]!.url).toBe(`https://login.microsoftonline.com/${DIRECTORY}/oauth2/v2.0/token`);
    });

    it('persists a rotated token before it is used, and does not refresh a fresh one', async () => {
        const persist = jest.fn(async () => undefined);
        fakeFetch(() => answer(200, { access_token: 'new', expires_in: 3600 }));
        expect(await resolveCalendarAccessToken({ accessToken: 'old', refreshToken: 'r', expiresAt: 10_000 }, { provider: 'GOOGLE', now: 1_000_000, persist })).toBe('old');
        expect(calls).toHaveLength(0);
        expect(await resolveCalendarAccessToken({ accessToken: 'old', refreshToken: 'r', expiresAt: 1_020 }, { provider: 'GOOGLE', now: 1_000_000, persist })).toBe('new');
        expect(persist).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new', refreshToken: 'r' }));
    });

    it('a withdrawn grant (400 invalid_grant) and a 401/403 are terminal; 429 and a Google rate 403 are throttles; 5xx is neither', async () => {
        fakeFetch(() => answer(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked; user someone@example.com' }));
        const err = await refreshCalendarToken({ provider: 'GOOGLE', refreshToken: 'r' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(IntegrationAuthError);
        expect((err as Error).message).not.toMatch(/someone@example\.com|expired or revoked/);
        fakeFetch(() => answer(400, { error: 'invalid_request' }));
        await expect(refreshCalendarToken({ provider: 'GOOGLE', refreshToken: 'r' })).rejects.not.toBeInstanceOf(IntegrationAuthError);
        fakeFetch(() => answer(401, {}));
        await expect(providerRequest('https://www.googleapis.com/calendar/v3/calendars', { method: 'GET' })).rejects.toBeInstanceOf(IntegrationAuthError);
        fakeFetch(() => answer(429, {}, { 'retry-after': '30' }));
        await expect(providerRequest('https://graph.microsoft.com/v1.0/me/calendars', { method: 'GET' })).rejects.toBeInstanceOf(IntegrationRateLimitedError);
        fakeFetch(() => answer(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }));
        await expect(providerRequest('https://www.googleapis.com/calendar/v3/calendars', { method: 'GET' })).rejects.toBeInstanceOf(IntegrationRateLimitedError);
        fakeFetch(() => answer(503, {}));
        await expect(providerRequest('https://www.googleapis.com/calendar/v3/calendars', { method: 'GET' })).rejects.toBeInstanceOf(ProviderHttpError);
    });

    it('sends nothing to a host that is not one of the four fixed origins', async () => {
        fakeFetch(() => answer(200, {}));
        for (const url of ['https://evil.example/token', 'http://graph.microsoft.com/v1.0', 'https://graph.microsoft.com.evil.example/', 'https://user:pw@graph.microsoft.com/', 'https://graph.microsoft.com:8443/']) {
            expect(providerUrlAllowed(url)).toBe(false);
            await expect(providerRequest(url, { method: 'GET' })).rejects.toThrow(/fixed provider origins/);
        }
        expect(calls).toHaveLength(0);
        expect(providerUrlAllowed('https://oauth2.googleapis.com/token')).toBe(true);
    });

    it('a stored blob parses back, and anything else is no token', () => {
        expect(parseCalendarToken(JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 }))).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
        expect(parseCalendarToken(null)).toBeNull();
        expect(parseCalendarToken('{"accessToken":1}')).toBeNull();
        expect(parseCalendarToken('not json')).toBeNull();
    });
});

describe('what an event carries (decision 229)', () => {
    const e = { kind: 'WORK_ITEM' as const, sourceId: 'w1', title: 'Fix login', dueDate: '2026-12-10', link: 'https://isl.test/t/acme/work-items/ISL-12' };

    it('Google: the title, one link as the whole description, an all-day private free event, the client id property; nothing else', () => {
        expect(googleEventBody('a'.repeat(40), e)).toEqual({
            summary: 'Fix login',
            description: 'https://isl.test/t/acme/work-items/ISL-12',
            start: { date: '2026-12-10' },
            end: { date: '2026-12-11' },
            transparency: 'transparent',
            visibility: 'private',
            extendedProperties: { private: { islestone: 'a'.repeat(40) } },
        });
    });

    it('Graph: the subject, the link as plain text, all-day private free; nothing else', () => {
        expect(graphEventBody(e)).toEqual({
            subject: 'Fix login',
            body: { contentType: 'text', content: 'https://isl.test/t/acme/work-items/ISL-12' },
            start: { dateTime: '2026-12-10T00:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-12-11T00:00:00', timeZone: 'UTC' },
            isAllDay: true,
            sensitivity: 'private',
            showAs: 'free',
        });
    });
});

describe('the sealed state', () => {
    const base = { purpose: 'connect' as const, tenantSlug: 'acme', userId: 'user_1', provider: 'GOOGLE' as const };

    it('round-trips; the verifier hashes to the challenge (S256)', () => {
        const { nonce, verifier, challenge } = newOAuthSecrets();
        expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
        const sealed = sealOAuthState({ ...base, nonce, verifier }, 1_000);
        const state = unsealOAuthState(sealed, 'connect', 2_000);
        expect(state).toMatchObject({ ...base, nonce, verifier });
        expect(stateMatches(nonce, state!)).toBe(true);
        expect(stateMatches(`${nonce}x`, state!)).toBe(false);
        expect(stateMatches(null, state!)).toBe(false);
    });

    it('refuses a tampered payload, another purpose, an old cookie and garbage', () => {
        const { nonce, verifier } = newOAuthSecrets();
        const sealed = sealOAuthState({ ...base, nonce, verifier }, 1_000);
        const [payload, mac] = sealed.split('.');
        const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), userId: 'user_2' })).toString('base64url');
        expect(unsealOAuthState(`${forged}.${mac}`, 'connect', 2_000)).toBeNull();
        expect(unsealOAuthState(sealed, 'admin-consent', 2_000)).toBeNull();
        expect(unsealOAuthState(sealed, 'connect', 1_000 + STATE_MAX_AGE_MS + 1)).toBeNull();
        expect(unsealOAuthState('garbage', 'connect')).toBeNull();
        expect(unsealOAuthState(undefined, 'connect')).toBeNull();
        // A connection's state without its verifier is no state.
        expect(unsealOAuthState(sealOAuthState({ ...base, nonce }, 1_000), 'connect', 2_000)).toBeNull();
    });
});

describe('the production startup check (CALENDAR_SYNC)', () => {
    it('refuses CALENDAR_SYNC=1 in production without a complete sign-in app pair, and nothing else', () => {
        expect(checkProductionCalendarSync({ NODE_ENV: 'production', CALENDAR_SYNC: '1' }).ok).toBe(false);
        expect(checkProductionCalendarSync({ NODE_ENV: 'production', CALENDAR_SYNC: '1', GOOGLE_CLIENT_ID: 'x' }).ok).toBe(false);
        expect(checkProductionCalendarSync({ NODE_ENV: 'production', CALENDAR_SYNC: '1', MICROSOFT_CLIENT_ID: 'x', MICROSOFT_CLIENT_SECRET: 'y' }).ok).toBe(true);
        expect(checkProductionCalendarSync({ NODE_ENV: 'production' }).ok).toBe(true);
        expect(checkProductionCalendarSync({ NODE_ENV: 'development', CALENDAR_SYNC: '1' }).ok).toBe(true);
    });
});
