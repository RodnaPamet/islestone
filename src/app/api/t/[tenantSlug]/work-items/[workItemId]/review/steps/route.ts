/**
 * Replace a work item's review steps not yet opened (sub-phase 2.8a; owner
 * decision 150): every step of the planned round, or the steps after the
 * open one. Key: `work_items.edit`. `If-Match` names the round's version and
 * is required once the item has a live round (428). Naming the item's
 * assignee is a 400 `REVIEWER_IS_ASSIGNEE` (decision 158).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetReviewStepsSchema } from '@/lib/schemas/review';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetReviewStepsSchema);
        return jsonResponse(await setWorkItemReviewSteps(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
