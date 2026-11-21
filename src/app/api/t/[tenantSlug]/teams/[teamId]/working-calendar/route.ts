/**
 * A team's own working calendar (roadmap 3.1a; ADR 0010 §5; decision 189):
 * read (`null` while the team uses the workspace's), given or changed, and
 * removed so the team goes back to the workspace's. Keys: reads take
 * `projects.view`; changes take `admin.manage`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTeamWorkingCalendar, removeTeamWorkingCalendar, setTeamWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { SetWorkingCalendarSchema } from '@/lib/schemas/working-calendar';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getTeamWorkingCalendar(ctx, params.teamId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkingCalendarSchema);
        return jsonResponse(await setTeamWorkingCalendar(ctx, params.teamId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeTeamWorkingCalendar(ctx, params.teamId));
    }),
);
