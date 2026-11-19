/**
 * A work item's relations (blocks, relates, duplicates): list both
 * directions, and add one. A BLOCKS edge that would close a cycle is a 409
 * (`RELATION_WOULD_CYCLE`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addWorkItemRelation, listWorkItemRelations } from '@/app-layer/usecases/work-item-relations';
import { AddWorkItemRelationSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listWorkItemRelations(ctx, params.workItemId));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddWorkItemRelationSchema);
        return jsonResponse(await addWorkItemRelation(ctx, params.workItemId, input), { status: 201 });
    }),
);
