/**
 * The sealed state of a calendar OAuth round trip (roadmap 3.3b;
 * docs/porting/maps/3.3.md, "Connecting a calendar", step 3; decisions 236
 * and 237).
 *
 * Both flows (a member connecting a calendar, an admin authorising Microsoft
 * 365) leave Islestone for the provider and come back to a fixed callback
 * outside `/t/`, so the workspace, the person and the provider travel in a
 * cookie:
 *
 *   <base64url(JSON)>.<base64url(HMAC-SHA256)>
 *   key = deriveSubkey('islestone-calendar-oauth-state-v1')  (the platform key)
 *
 * The JSON carries a random nonce (the `state` the provider echoes), the
 * workspace's slug, the user's id, the provider and, for a connection, the
 * PKCE verifier (S256). The cookie is HttpOnly, `SameSite=Lax` (it must
 * survive the provider's top-level redirect back), scoped to
 * `/api/integrations/calendar` and lives 10 minutes. The callback refuses a
 * MAC that does not verify, an older cookie, a nonce that is not the returned
 * state, a user who is not the session's, and a nonce already used: the nonce
 * is claimed once in Redis for 10 minutes (`claimStateNonce`), and an
 * unreachable Redis refuses (fail closed).
 *
 * Signed, not encrypted: the verifier sits in the browser that started the
 * flow, which is the client PKCE protects. Server-only. Written fresh for
 * Islestone, on the pattern of `src/lib/intake/public/form-token.ts`.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { CalendarProvider } from '@prisma/client';

import { getRedis } from '@/lib/redis';
import { deriveSubkey } from '@/lib/security/encryption';

const PURPOSE = 'islestone-calendar-oauth-state-v1';
export const STATE_MAX_AGE_MS = 10 * 60 * 1000;
export const CONNECT_STATE_COOKIE = 'isl_cal_connect';
export const ADMIN_STATE_COOKIE = 'isl_cal_admin';
export const STATE_COOKIE_PATH = '/api/integrations/calendar';
const NONCE = /^[A-Za-z0-9_-]{32}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;
const SLUG = /^[a-z0-9-]{1,80}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type CalendarOAuthPurpose = 'connect' | 'admin-consent';

export interface CalendarOAuthState {
    v: 1;
    purpose: CalendarOAuthPurpose;
    nonce: string;
    tenantSlug: string;
    userId: string;
    provider: CalendarProvider;
    /** PKCE verifier; a connection's only. */
    verifier?: string;
    issuedAt: number;
}

function mac(payload: string): Buffer {
    return createHmac('sha256', deriveSubkey(PURPOSE)).update(payload).digest();
}

/** A fresh nonce and, for a connection, a PKCE verifier with its S256 challenge. */
export function newConnectNonces(): { nonce: string; verifier: string; challenge: string } {
    const verifier = randomBytes(48).toString('base64url');
    return {
        nonce: randomBytes(24).toString('base64url'),
        verifier,
        challenge: createHash('sha256').update(verifier).digest('base64url'),
    };
}

export function sealCalendarState(state: Omit<CalendarOAuthState, 'v' | 'issuedAt'>, now: number = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, ...state, issuedAt: now })).toString('base64url');
    return `${payload}.${mac(payload).toString('base64url')}`;
}

/** The state, when the cookie is Islestone's, whole and young; null otherwise. */
export function unsealCalendarState(cookie: string | undefined | null, purpose: CalendarOAuthPurpose, now: number = Date.now()): CalendarOAuthState | null {
    if (typeof cookie !== 'string' || cookie.length > 2048) return null;
    const dot = cookie.indexOf('.');
    if (dot < 1 || dot !== cookie.lastIndexOf('.')) return null;
    const payload = cookie.slice(0, dot);
    const given = Buffer.from(cookie.slice(dot + 1), 'base64url');
    const expected = mac(payload);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    let s: Partial<CalendarOAuthState>;
    try {
        s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CalendarOAuthState>;
    } catch {
        return null;
    }
    if (s.v !== 1 || s.purpose !== purpose) return null;
    if (typeof s.nonce !== 'string' || !NONCE.test(s.nonce)) return null;
    if (typeof s.tenantSlug !== 'string' || !SLUG.test(s.tenantSlug)) return null;
    if (typeof s.userId !== 'string' || !ID.test(s.userId)) return null;
    if (s.provider !== 'GOOGLE' && s.provider !== 'MICROSOFT') return null;
    if (purpose === 'connect' && (typeof s.verifier !== 'string' || !VERIFIER.test(s.verifier))) return null;
    if (typeof s.issuedAt !== 'number' || now - s.issuedAt < 0 || now - s.issuedAt > STATE_MAX_AGE_MS) return null;
    return s as CalendarOAuthState;
}

/** Constant-time equality of the returned `state` and the sealed nonce. */
export function stateMatches(returned: string | null, sealed: CalendarOAuthState): boolean {
    if (!returned) return false;
    const a = Buffer.from(returned);
    const b = Buffer.from(sealed.nonce);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Claim a state's nonce once (Redis `SET NX` for the state's lifetime). False
 * when it was claimed before, or when Redis cannot answer within two seconds:
 * a state that cannot be proved unused is refused.
 */
export async function claimStateNonce(nonce: string): Promise<boolean> {
    const redis = getRedis();
    if (!redis) return false;
    try {
        const answer = await Promise.race([
            redis.set(`calendar-oauth-state:${nonce}`, '1', 'PX', STATE_MAX_AGE_MS, 'NX'),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000).unref()),
        ]);
        return answer === 'OK';
    } catch {
        return false;
    }
}
