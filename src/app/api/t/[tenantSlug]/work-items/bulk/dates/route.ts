/**
 * Change the dates of a dragged work item and of the items it pushes later
 * (roadmap 3.1c; owner decision 194): all or nothing, each item's version
 * checked against its locked row (`rescheduleWorkItems`).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { rescheduleWorkItems } from '@/app-layer/usecases/work-item';
import { RescheduleWorkItemsSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.edit', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, RescheduleWorkItemsSchema);
        return jsonResponse(await rescheduleWorkItems(ctx, input));
    }),
);
