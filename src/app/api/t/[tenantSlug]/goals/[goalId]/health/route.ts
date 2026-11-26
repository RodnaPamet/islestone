/**
 * Set or clear a goal's health (sub-phase 3.2b; owner decisions 205 and 214):
 * a person holding `goals.manage`, never an API key, an agent or a job.
 * `If-Match` optional. Never changes the goal's status, and nothing else
 * changes its health.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setGoalHealth } from '@/app-layer/usecases/goal-health';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetHealthSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetHealthSchema);
        return jsonResponse(await setGoalHealth(ctx, params.goalId, input.health, expectedVersionFrom(req)));
    }),
);
