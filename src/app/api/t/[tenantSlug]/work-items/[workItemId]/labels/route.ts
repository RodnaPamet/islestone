/**
 * Attach labels to a work item (its version increases).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addWorkItemLabels } from '@/app-layer/usecases/work-item-collab';
import { AddWorkItemLabelsSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddWorkItemLabelsSchema);
        return jsonResponse(await addWorkItemLabels(ctx, params.workItemId, input.labelIds));
    }),
);
