/**
 * Add holidays to a team's own working calendar (roadmap 3.1a; decision
 * 190): by hand, "Copy last year's" or "Copy the workspace's holidays"; a
 * date already there is skipped. Key: `admin.manage`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addTeamHolidays } from '@/app-layer/usecases/working-calendar';
import { AddHolidaysSchema } from '@/lib/schemas/working-calendar';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddHolidaysSchema);
        return jsonResponse(await addTeamHolidays(ctx, params.teamId, input), { status: 201 });
    }),
);
