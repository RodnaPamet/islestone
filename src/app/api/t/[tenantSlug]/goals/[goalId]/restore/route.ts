/**
 * Restore a deleted goal's group: the goals and initiatives deleted with it
 * (sub-phase 3.2a, decision 218). Key: `goals.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreGoal } from '@/app-layer/usecases/goal';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreGoal(ctx, params.goalId));
    }),
);
