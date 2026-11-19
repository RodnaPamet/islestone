/**
 * Detach a label from a work item (its version increases).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeWorkItemLabel } from '@/app-layer/usecases/work-item-collab';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; labelId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeWorkItemLabel(ctx, params.workItemId, params.labelId));
    }),
);
