/**
 * Assign many work items to one member, or clear them. One email for everything newly handed over.
 *
 * Copied from inflect-compliance's `tasks/bulk/*` routes at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, renamed (`workItemIds`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkAssignWorkItems } from '@/app-layer/usecases/work-item';
import { BulkWorkItemAssignSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.assign', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, BulkWorkItemAssignSchema);
        return jsonResponse(await bulkAssignWorkItems(ctx, input));
    }),
);
