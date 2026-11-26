/**
 * Calendar sync's HTTP edges (roadmap 3.3b): the deployment switch as a 404
 * in front of every route, and the sealed state cookie's attributes. Server-only.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/env';

import { STATE_COOKIE_PATH, STATE_MAX_AGE_MS } from './oauth-state';
import { isCalendarSyncOpen } from './switch';

/** Closed (`CALENDAR_SYNC`), every calendar sync route answers 404, before its permission check. */
export function whenCalendarSyncOpen<A extends unknown[]>(handler: (req: NextRequest, ...rest: A) => Promise<Response>) {
    return async (req: NextRequest, ...rest: A): Promise<Response> => {
        if (!isCalendarSyncOpen()) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404 });
        return handler(req, ...rest);
    };
}

/** HttpOnly, `SameSite=Lax` (it survives the provider's redirect back), scoped to the callbacks, ten minutes. */
export function stateCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: env.NODE_ENV === 'production',
        path: STATE_COOKIE_PATH,
        maxAge: Math.floor(STATE_MAX_AGE_MS / 1000),
    };
}
