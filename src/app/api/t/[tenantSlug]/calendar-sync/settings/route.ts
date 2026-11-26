/**
 * Settings → Calendar sync (roadmap 3.3b; ADR 0011 §5; owner decision 234):
 * read, and "Allow members to sync their calendars". Both take
 * `integrations.manage` (Owners and Admins). Turning it off tears down every
 * connection. Closed by `CALENDAR_SYNC`, a 404.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getCalendarSyncSettings, setCalendarSyncEnabled } from '@/app-layer/usecases/calendar-sync-settings';
import { whenCalendarSyncOpen } from '@/lib/calendar-sync/http';
import { SetCalendarSyncSettingsSchema } from '@/lib/schemas/calendar-sync';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('integrations.manage', async (_req: NextRequest, _route, ctx) => {
            return jsonResponse(await getCalendarSyncSettings(ctx));
        }),
    ),
);

export const PUT = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('integrations.manage', async (req: NextRequest, _route, ctx) => {
            const input = await parseJsonBody(req, SetCalendarSyncSettingsSchema);
            return jsonResponse(await setCalendarSyncEnabled(ctx, input));
        }),
    ),
);
