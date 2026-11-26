/**
 * A work item's ancestry in one statement (sub-phase 3.2a, decision 220):
 * its parents, project, initiative and goals, and its own direct goal's
 * chain. Key: `work_items.view`; 404 when the item is missing or invisible.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemAncestry } from '@/app-layer/usecases/work-item-ancestry';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getWorkItemAncestry(ctx, params.workItemId));
    }),
);
