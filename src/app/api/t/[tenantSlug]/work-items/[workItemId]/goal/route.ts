/**
 * Name a work item's goal directly, or clear it (sub-phase 3.2a, owner
 * decision 211). A single-field change: `If-Match` optional (ADR 0002 §9).
 * Key: `work_items.edit`; naming a goal also asks `goals.view` in the usecase.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemGoal } from '@/app-layer/usecases/work-item-goal';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemGoalSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemGoalSchema);
        return jsonResponse(await setWorkItemGoal(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
