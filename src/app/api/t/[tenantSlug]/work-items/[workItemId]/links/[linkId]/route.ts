/**
 * Remove a link, scoped to the work item that owns it. Copied from
 * inflect-compliance's `tasks/[taskId]/links/[linkId]/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeWorkItemLink } from '@/app-layer/usecases/work-item-collab';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; linkId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeWorkItemLink(ctx, params.workItemId, params.linkId));
    }),
);
