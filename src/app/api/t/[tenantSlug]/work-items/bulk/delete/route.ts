/**
 * Soft-delete many work items with their sub-items under one `deletionId`. The route key equals the usecase's assert, so a refusal is audited.
 *
 * Copied from inflect-compliance's `tasks/bulk/*` routes at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, renamed (`workItemIds`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { bulkDeleteWorkItems } from '@/app-layer/usecases/work-item';
import { BulkWorkItemDeleteSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.delete', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, BulkWorkItemDeleteSchema);
        return jsonResponse(await bulkDeleteWorkItems(ctx, input.workItemIds));
    }),
);
