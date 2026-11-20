/**
 * Add one person to a review step that has not ended (sub-phase 2.8a): an
 * active member who sees the project, never the item's assignee (decision
 * 158); on an open step they are asked at once. Key: `work_items.edit`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addReviewStepReviewer } from '@/app-layer/usecases/review';
import { AddReviewerSchema } from '@/lib/schemas/review';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; stepId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddReviewerSchema);
        return jsonResponse(await addReviewStepReviewer(ctx, params.workItemId, params.stepId, input));
    }),
);
