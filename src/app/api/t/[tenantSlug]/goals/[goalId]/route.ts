/**
 * One goal (sub-phase 3.2a): read it with its ancestors, children and
 * initiatives (`goals.view`); change it (`goals.manage`; `If-Match` required
 * for a title or description change); delete it softly, with the goals below
 * it and their initiatives (`goals.manage`, decision 218).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteGoal, getGoal, updateGoal } from '@/app-layer/usecases/goal';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { UpdateGoalSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getGoal(ctx, params.goalId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateGoalSchema);
        return jsonResponse(await updateGoal(ctx, params.goalId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteGoal(ctx, params.goalId));
    }),
);
