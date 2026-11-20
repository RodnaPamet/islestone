/**
 * One cycle (sub-phase 2.5a): read with its counts, rename or move its dates,
 * delete an upcoming one (its items leave it first). Keys: `cycles.view`
 * reads, `cycles.manage` changes.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteCycle, getCycle, updateCycle } from '@/app-layer/usecases/cycle';
import { UpdateCycleSchema } from '@/lib/schemas/cycle';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; cycleId: string }>('cycles.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getCycle(ctx, params.cycleId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; cycleId: string }>('cycles.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateCycleSchema);
        return jsonResponse(await updateCycle(ctx, params.cycleId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; cycleId: string }>('cycles.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteCycle(ctx, params.cycleId));
    }),
);
