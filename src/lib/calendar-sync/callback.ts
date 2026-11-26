/**
 * What both calendar OAuth callbacks share (roadmap 3.3b): where the browser
 * is sent back, with an outcome code from a closed list, and the sealed state
 * cookie cleared (single use). Server-only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { appLink } from '@/app-layer/notifications/app-link';

import { STATE_COOKIE_PATH } from './oauth-state';

export const CONNECT_OUTCOMES = ['connected', 'declined', 'failed', 'sync_off', 'not_authorised', 'no_refresh_token', 'refused'] as const;
export const CONSENT_OUTCOMES = ['consent_granted', 'consent_declined', 'consent_failed'] as const;
export type CallbackOutcome = (typeof CONNECT_OUTCOMES)[number] | (typeof CONSENT_OUTCOMES)[number];

/** A provider's `error` code, only when it has the shape of one; never `error_description`. */
export function providerErrorCode(raw: string | null): string | null {
    return raw && /^[a-z_]{1,64}$/.test(raw) ? raw : raw ? 'unrecognised' : null;
}

export function redirectBack(req: NextRequest, cookieName: string, path: string, outcome: CallbackOutcome): NextResponse {
    const base = /^https?:\/\//.test(appLink('/')) ? appLink('/') : req.nextUrl.origin;
    const url = new URL(path, base);
    url.searchParams.set('calendar', outcome);
    const res = NextResponse.redirect(url);
    res.cookies.set(cookieName, '', { path: STATE_COOKIE_PATH, maxAge: 0 });
    return res;
}
