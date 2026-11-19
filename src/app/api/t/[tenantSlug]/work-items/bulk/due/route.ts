/**
 * Set (or clear) the due date of many work items; dates are `YYYY-MM-DD`.
 *
 * Copied from inflect-compliance's `tasks/bulk/*` routes at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, renamed (`workItemIds`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkSetWorkItemDueDate } from '@/app-layer/usecases/work-item';
import { BulkWorkItemDueDateSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.edit', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, BulkWorkItemDueDateSchema);
        return jsonResponse(await bulkSetWorkItemDueDate(ctx, input));
    }),
);
