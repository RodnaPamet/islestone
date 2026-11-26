/**
 * "Connect Google Calendar" / "Connect Outlook Calendar" (roadmap 3.3b; ADR
 * 0011 §5 and §6; owner decisions 234 to 237): `POST ?provider=google|microsoft`
 * under `work_items.view`, keyed off the caller (never a user id in the
 * route). Answers `{ authorizeUrl }` as JSON, which the browser navigates to,
 * and sets the sealed state cookie the callback checks. Refused 409
 * `CALENDAR_SYNC_OFF`, `PROVIDER_NOT_CONFIGURED` or `MICROSOFT_NOT_AUTHORISED`.
 * Closed by `CALENDAR_SYNC`, a 404.
 *
 * Adapted from inflect-compliance `src/app/api/t/[tenantSlug]/calendar/connect/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { startCalendarConnect } from '@/app-layer/usecases/calendar-connection';
import { stateCookieOptions, whenCalendarSyncOpen } from '@/lib/calendar-sync/http';
import { providerParam } from '@/lib/schemas/calendar-sync';

export const POST = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _route, ctx) => {
            const { authorizeUrl, stateCookie } = await startCalendarConnect(ctx, providerParam(req.nextUrl.searchParams.get('provider')));
            const res = jsonResponse({ authorizeUrl });
            res.cookies.set(stateCookie.name, stateCookie.value, stateCookieOptions());
            return res;
        }),
    ),
);
