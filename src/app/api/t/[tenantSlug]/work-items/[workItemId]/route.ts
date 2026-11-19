/**
 * One work item: read, edit, delete.
 *
 * PATCH takes the version edited in `If-Match` (required for title and
 * description, ADR 0002 §9) and answers 409 with `{ version, item }` on a
 * conflict. DELETE is a soft delete of the item and its sub-items; the route
 * key equals the usecase's assert, so a refusal is audited. Copied from
 * inflect-compliance's `tasks/[taskId]/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteWorkItem, getWorkItem, updateWorkItem } from '@/app-layer/usecases/work-item';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { UpdateWorkItemSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getWorkItem(ctx, params.workItemId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateWorkItemSchema);
        return jsonResponse(await updateWorkItem(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.delete', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteWorkItem(ctx, params.workItemId));
    }),
);
