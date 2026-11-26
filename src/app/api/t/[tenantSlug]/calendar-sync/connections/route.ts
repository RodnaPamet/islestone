/**
 * The caller's own calendar connections (roadmap 3.3b; ADR 0011 §5 and §8;
 * owner decisions 235 and 239), under `work_items.view`, keyed off the caller:
 * GET what may be connected and what is; `DELETE ?provider=…` disconnects
 * (the teardown removes Islestone's events, then the token); `POST
 * ?provider=… { action }` is "Resync my calendar" or "Recreate" (3.3c,
 * decision 232). Closed by `CALENDAR_SYNC`, a 404.
 *
 * Adapted from inflect-compliance `src/app/api/t/[tenantSlug]/calendar/connections/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { actOnCalendarConnection, disconnectCalendar, getMyCalendarSync } from '@/app-layer/usecases/calendar-connection';
import { whenCalendarSyncOpen } from '@/lib/calendar-sync/http';
import { CalendarConnectionActionSchema, providerParam } from '@/lib/schemas/calendar-sync';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('work_items.view', async (_req: NextRequest, _route, ctx) => {
            return jsonResponse(await getMyCalendarSync(ctx));
        }),
    ),
);

export const DELETE = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _route, ctx) => {
            return jsonResponse(await disconnectCalendar(ctx, providerParam(req.nextUrl.searchParams.get('provider'))));
        }),
    ),
);

export const POST = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _route, ctx) => {
            const provider = providerParam(req.nextUrl.searchParams.get('provider'));
            const { action } = await parseJsonBody(req, CalendarConnectionActionSchema);
            return jsonResponse(await actOnCalendarConnection(ctx, provider, action));
        }),
    ),
);
