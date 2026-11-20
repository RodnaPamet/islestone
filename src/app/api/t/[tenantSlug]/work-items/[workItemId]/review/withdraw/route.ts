/**
 * Withdraw the open review round (sub-phase 2.8a; ADR 0009 §4): it ends
 * unfinished, its record unchanged, and a planned round with the same steps
 * follows. Key: `work_items.edit`; `If-Match` (the round's version) optional.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withdrawWorkItemReview } from '@/app-layer/usecases/review';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        return jsonResponse(await withdrawWorkItemReview(ctx, params.workItemId, expectedVersionFrom(req)));
    }),
);
