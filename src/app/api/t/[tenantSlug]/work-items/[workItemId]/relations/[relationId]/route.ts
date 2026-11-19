/**
 * Remove a relation, scoped to a work item that is one of its ends.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeWorkItemRelation } from '@/app-layer/usecases/work-item-relations';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; relationId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeWorkItemRelation(ctx, params.workItemId, params.relationId));
    }),
);
