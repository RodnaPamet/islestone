/**
 * The workspace's working calendar (roadmap 3.1a; ADR 0010 §5; owner
 * decisions 189 to 193): read with which teams have their own, and saved.
 * Keys: reads take `projects.view`; a change takes `admin.manage`, as teams
 * and workflow states.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkingCalendars, setWorkspaceWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { SetWorkingCalendarSchema } from '@/lib/schemas/working-calendar';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (_req: NextRequest, _route, ctx) => {
        return jsonResponse(await getWorkingCalendars(ctx));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _route, ctx) => {
        const input = await parseJsonBody(req, SetWorkingCalendarSchema);
        return jsonResponse(await setWorkspaceWorkingCalendar(ctx, input));
    }),
);
