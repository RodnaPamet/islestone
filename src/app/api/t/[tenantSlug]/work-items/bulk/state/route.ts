/**
 * Set the state of many work items: a `stateId`, or a `stateCategory` mapped per team to its default state of that category. All or nothing.
 *
 * Copied from inflect-compliance's `tasks/bulk/*` routes at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, renamed (`workItemIds`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkSetWorkItemState } from '@/app-layer/usecases/work-item';
import { BulkWorkItemStateSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.edit', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, BulkWorkItemStateSchema);
        return jsonResponse(await bulkSetWorkItemState(ctx, input));
    }),
);
