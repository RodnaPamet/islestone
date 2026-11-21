/**
 * Remove a holiday from a team's own working calendar (roadmap 3.1a). Key:
 * `admin.manage`. The Settings page sends it from the undo toast.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeTeamHoliday } from '@/app-layer/usecases/working-calendar';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string; holidayId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeTeamHoliday(ctx, params.teamId, params.holidayId));
    }),
);
