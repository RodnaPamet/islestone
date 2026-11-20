/**
 * "Send for review" (sub-phase 2.8a; owner decision 155): open the planned
 * round's first step. Key: `work_items.edit`; `If-Match` (the round's
 * version) optional. Refused for a closed item, a round with no steps, or a
 * step nobody can be asked at (409 `NO_REVIEWERS`).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { sendWorkItemReview } from '@/app-layer/usecases/review';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        return jsonResponse(await sendWorkItemReview(ctx, params.workItemId, expectedVersionFrom(req)));
    }),
);
