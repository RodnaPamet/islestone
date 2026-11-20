/**
 * A reviewer's response to the open step, Signed off or Returned (sub-phase
 * 2.8a; owner decisions 156 to 158, 162 and 163), or a change to it while the
 * step is open. Key: `work_items.view` (decision 160); the usecase refuses an
 * API key (`NOT_A_PERSON`), a person not named on the step and the item's
 * assignee (403, audited).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { respondToReviewStep } from '@/app-layer/usecases/review';
import { RespondToReviewSchema } from '@/lib/schemas/review';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; stepId: string }>('work_items.view', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, RespondToReviewSchema);
        return jsonResponse(await respondToReviewStep(ctx, params.workItemId, params.stepId, input));
    }),
);
