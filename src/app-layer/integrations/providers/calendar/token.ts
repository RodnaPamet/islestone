/**
 * The OAuth token lifecycle for calendar sync, Google and Microsoft (roadmap
 * 3.3b; ADR 0011 §6; owner decisions 228, 236 and 237).
 *
 * Copied from inflect-compliance `src/app-layer/integrations/providers/calendar/token.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and adapted:
 *
 * - PKCE (S256) on both authorize URLs and the code exchange;
 * - the scopes of decision 228: Google's `calendar.app.created` (only the
 *   calendars the app created), Microsoft's `offline_access Calendars.ReadWrite`;
 *   never `openid`, `email` or `profile`, and Google's URL does NOT set
 *   `include_granted_scopes`, so the calendar token carries the calendar scope
 *   alone and never the sign-in grant's (decision 236);
 * - the sign-in apps' credentials (`GOOGLE_*`, `MICROSOFT_*`, decision 236),
 *   read through `@/env`; nothing here imports `next-auth` (ADR 0004 A3);
 * - Microsoft's authority is the consented directory's id (a GUID), never
 *   `MICROSOFT_TENANT_ID`, which is sign-in's;
 * - admin consent through the v2 `/adminconsent` endpoint with the calendar
 *   scope named, so the grant covers calendar access and not every permission
 *   the shared registration declares;
 * - every request through `providerRequest` (fixed origins, classified
 *   failures); no call to Google's revoke endpoint exists or may be added
 *   (decision 236: revoking one token may withdraw the person's whole grant to
 *   the shared app, sign-in included). Tokens are destroyed locally.
 *
 * Kept from the source: the refresh asks the SAME scopes (never the sign-in
 * refresher's, which would return a token without calendar access an hour
 * after consent); `refresh_token ?? current` (Google returns none on refresh,
 * Microsoft rotates); a missing refresh token at consent refuses the
 * connection; the new token is persisted at rotation, before it is used;
 * a 60-second skew.
 */
import type { CalendarProvider } from '@prisma/client';

import { env } from '@/env';

import { providerRequest } from './provider-http';

/** Decision 228. A widening is a reviewed diff here. */
export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.app.created'] as const;
export const MICROSOFT_CALENDAR_SCOPES = ['offline_access', 'Calendars.ReadWrite'] as const;
/** What an admin consents to for the whole directory (decision 237). */
export const MICROSOFT_ADMIN_CONSENT_SCOPES = ['https://graph.microsoft.com/Calendars.ReadWrite'] as const;

const EXPIRY_SKEW_SECONDS = 60;
const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com';
/** A Microsoft directory id, as the admin-consent callback returns it. */
export const MICROSOFT_DIRECTORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The decrypted shape of `CalendarConnection.tokenEncrypted`. */
export interface CalendarToken {
    accessToken: string;
    refreshToken: string;
    /** Unix seconds. */
    expiresAt: number;
}

function microsoftAuthority(directoryId: string): string {
    if (!MICROSOFT_DIRECTORY_ID.test(directoryId)) throw new Error('The Microsoft directory id is not a GUID.');
    return `${MICROSOFT_AUTHORITY}/${directoryId}`;
}

function clientCredentials(provider: CalendarProvider): { client_id: string; client_secret: string } {
    const id = provider === 'GOOGLE' ? env.GOOGLE_CLIENT_ID : env.MICROSOFT_CLIENT_ID;
    const secret = provider === 'GOOGLE' ? env.GOOGLE_CLIENT_SECRET : env.MICROSOFT_CLIENT_SECRET;
    if (!id || !secret) throw new Error(`The ${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} sign-in app is not configured.`);
    return { client_id: id, client_secret: secret };
}

function scopesOf(provider: CalendarProvider): string {
    return (provider === 'GOOGLE' ? GOOGLE_CALENDAR_SCOPES : MICROSOFT_CALENDAR_SCOPES).join(' ');
}

/**
 * Where a customer directory's admin authorises calendar access once for every
 * member (decision 237). The answer carries no code: `admin_consent=True` and
 * the directory's id (`tenant`). `organizations` lets the admin consent in
 * their own directory.
 */
export function buildMicrosoftAdminConsentUrl(opts: { redirectUri: string; state: string }): string {
    const params = new URLSearchParams({
        client_id: clientCredentials('MICROSOFT').client_id,
        redirect_uri: opts.redirectUri,
        state: opts.state,
        scope: MICROSOFT_ADMIN_CONSENT_SCOPES.join(' '),
    });
    return `${MICROSOFT_AUTHORITY}/organizations/v2.0/adminconsent?${params.toString()}`;
}

/** Where a member goes to connect their own calendar. */
export function buildCalendarAuthorizeUrl(opts: {
    provider: CalendarProvider;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    /** Microsoft: the consented directory. */
    microsoftDirectoryId?: string | null;
}): string {
    const common = {
        client_id: clientCredentials(opts.provider).client_id,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: scopesOf(opts.provider),
        state: opts.state,
        code_challenge: opts.codeChallenge,
        code_challenge_method: 'S256',
    };
    if (opts.provider === 'GOOGLE') {
        // Both are needed for a refresh token: `access_type=offline` asks for
        // one, `prompt=consent` re-issues it on a reconnect. No
        // `include_granted_scopes`: the sign-in grant's scopes stay out.
        const params = new URLSearchParams({ ...common, access_type: 'offline', prompt: 'consent' });
        return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
    }
    if (!opts.microsoftDirectoryId) throw new Error('Microsoft calendar access has not been authorised for this workspace.');
    // No `prompt`: the directory's admin consented for everyone.
    const params = new URLSearchParams(common);
    return `${microsoftAuthority(opts.microsoftDirectoryId)}/oauth2/v2.0/authorize?${params.toString()}`;
}

function tokenEndpoint(provider: CalendarProvider, microsoftDirectoryId?: string | null): string {
    if (provider === 'GOOGLE') return GOOGLE_TOKEN;
    if (!microsoftDirectoryId) throw new Error('Microsoft calendar access has not been authorised for this workspace.');
    return `${microsoftAuthority(microsoftDirectoryId)}/oauth2/v2.0/token`;
}

interface TokenAnswer {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
}

async function postToken(url: string, body: Record<string, string>, label: string): Promise<TokenAnswer> {
    const res = await providerRequest(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) },
        { tokenEndpoint: true },
    );
    if (!res.ok) throw new Error(`Calendar ${label} failed: HTTP ${res.status}.`);
    const answer = (res.json ?? {}) as TokenAnswer;
    if (typeof answer.access_token !== 'string' || typeof answer.expires_in !== 'number') {
        throw new Error(`Calendar ${label} answered without a token.`);
    }
    return answer;
}

/** The first token pair, from the code and its PKCE verifier. */
export async function exchangeCalendarCode(opts: {
    provider: CalendarProvider;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    microsoftDirectoryId?: string | null;
    now?: number;
}): Promise<{ token: CalendarToken; scopesGranted: string[] }> {
    const answer = await postToken(
        tokenEndpoint(opts.provider, opts.microsoftDirectoryId),
        {
            ...clientCredentials(opts.provider),
            grant_type: 'authorization_code',
            code: opts.code,
            code_verifier: opts.codeVerifier,
            redirect_uri: opts.redirectUri,
        },
        'code exchange',
    );
    if (typeof answer.refresh_token !== 'string' || !answer.refresh_token) {
        // Without one the connection works until the first expiry, then dies
        // overnight: refuse now, while the member is here to reconnect.
        throw new MissingRefreshTokenError();
    }
    const now = opts.now ?? Date.now();
    return {
        token: { accessToken: answer.access_token as string, refreshToken: answer.refresh_token, expiresAt: Math.floor(now / 1000) + (answer.expires_in as number) },
        scopesGranted: typeof answer.scope === 'string' ? answer.scope.split(' ').filter(Boolean).slice(0, 20) : [],
    };
}

export class MissingRefreshTokenError extends Error {
    constructor() {
        super('The calendar consent returned no refresh token.');
        this.name = 'MissingRefreshTokenError';
    }
}

/** A new pair from the refresh token, asking the same scopes. */
export async function refreshCalendarToken(opts: {
    provider: CalendarProvider;
    refreshToken: string;
    microsoftDirectoryId?: string | null;
    now?: number;
}): Promise<CalendarToken> {
    const answer = await postToken(
        tokenEndpoint(opts.provider, opts.microsoftDirectoryId),
        { ...clientCredentials(opts.provider), grant_type: 'refresh_token', refresh_token: opts.refreshToken, scope: scopesOf(opts.provider) },
        'token refresh',
    );
    const now = opts.now ?? Date.now();
    return {
        accessToken: answer.access_token as string,
        refreshToken: typeof answer.refresh_token === 'string' && answer.refresh_token ? answer.refresh_token : opts.refreshToken,
        expiresAt: Math.floor(now / 1000) + (answer.expires_in as number),
    };
}

/**
 * A still-valid access token, refreshed and persisted when the current one is
 * inside the skew. `persist` runs at rotation, before the caller uses the new
 * token: Microsoft invalidates the old refresh token.
 */
export async function resolveCalendarAccessToken(
    current: CalendarToken,
    opts: { provider: CalendarProvider; microsoftDirectoryId?: string | null; now?: number; persist: (token: CalendarToken) => Promise<void> },
): Promise<string> {
    const nowSeconds = (opts.now ?? Date.now()) / 1000;
    if (nowSeconds < current.expiresAt - EXPIRY_SKEW_SECONDS) return current.accessToken;
    const rotated = await refreshCalendarToken({ provider: opts.provider, refreshToken: current.refreshToken, microsoftDirectoryId: opts.microsoftDirectoryId, now: opts.now });
    await opts.persist(rotated);
    return rotated.accessToken;
}

/** Parse a stored token blob; null when it is not one. */
export function parseCalendarToken(raw: string | null): CalendarToken | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw) as Partial<CalendarToken>;
        if (typeof v.accessToken === 'string' && typeof v.refreshToken === 'string' && typeof v.expiresAt === 'number') {
            return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt };
        }
    } catch {
        // falls through
    }
    return null;
}
