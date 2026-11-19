/**
 * Work-item counts by state category, overdue and unassigned.
 *
 * Read-gated on `work_items.view`; counts only items in projects visible to the
 * caller (deleted projects never, archived ones only with `includeArchived`).
 * Copied from inflect-compliance's `tasks/metrics/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e without its aggregation cache.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemMetrics } from '@/app-layer/usecases/work-item';
import { WorkItemQuerySchema } from '@/lib/schemas/work-item';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _args, ctx) => {
        const query = WorkItemQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(
            await getWorkItemMetrics(ctx, {
                projectId: query.projectId,
                teamId: query.teamId,
                typeId: query.typeId,
                assigneeId: query.assigneeId,
                labelId: query.labelId,
                includeArchived: query.includeArchived === 'true' || query.includeArchived === '1',
            }),
        );
    }),
);
