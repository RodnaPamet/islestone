/**
 * Set a work item's estimate in its team's current unit, or clear it
 * (sub-phase 3.4a, owner decision 257; ADR 0002 §18). A single-field change:
 * `If-Match` optional (ADR 0002 §9). 409 `ESTIMATES_OFF` when the team does
 * not estimate; 400 `ESTIMATE_UNIT` when the body names another unit.
 * Key: `work_items.edit`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemEstimate } from '@/app-layer/usecases/work-item-estimate';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemEstimateSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemEstimateSchema);
        return jsonResponse(await setWorkItemEstimate(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
