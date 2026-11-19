/**
 * Move a work item to another state of its team (`If-Match` optional: a
 * single-field change). Copied from inflect-compliance's
 * `tasks/[taskId]/status/route.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (body `{ stateId }`, no resolution).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemState } from '@/app-layer/usecases/work-item';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemStateSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemStateSchema);
        return jsonResponse(await setWorkItemState(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
