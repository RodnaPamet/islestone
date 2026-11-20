/**
 * Withdraw a pending reviewer from a step that has not ended (sub-phase 2.8a):
 * withdrawn, never deleted. Key: `work_items.edit`; on an open step the
 * usecase also asks the standing of decision 150 (it can complete the step).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeReviewStepReviewer } from '@/app-layer/usecases/review';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; stepId: string; userId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeReviewStepReviewer(ctx, params.workItemId, params.stepId, params.userId));
    }),
);
