/**
 * A team's cycle schedule (sub-phase 2.5a, owner decision 63): read, and save
 * (which fills the schedule's cycles at once while it is enabled). Keys:
 * `cycles.view` reads, `cycles.manage` saves (owner decision 72: Members run
 * their team's cycles; the team itself stays under `admin.manage`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getCycleSchedule, setCycleSchedule } from '@/app-layer/usecases/cycle';
import { SetCycleScheduleSchema } from '@/lib/schemas/cycle';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('cycles.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getCycleSchedule(ctx, params.teamId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('cycles.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetCycleScheduleSchema);
        return jsonResponse(await setCycleSchedule(ctx, params.teamId, input));
    }),
);
