/**
 * A work item's review (sub-phase 2.8a; ADR 0009): its rounds, newest first,
 * with their steps, reviewers and responses (the response text decrypted for
 * readers of the item), and what the caller may do. Key: `work_items.view`
 * (decision 160); a GUEST, who holds no key until 8.4 (decision 204), gets the 403.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemReview } from '@/app-layer/usecases/review';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getWorkItemReview(ctx, params.workItemId));
    }),
);
