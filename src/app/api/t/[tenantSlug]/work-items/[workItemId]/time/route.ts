/**
 * An item's time (sub-phase 3.4b; owner decision 266): its total, the
 * caller's own, and its entries newest first, 50 a page (`?cursor=`). Read
 * under `work_items.view`; the usecase also asks `time.view` (everyone's
 * entries and the total) or `time.track` (only one's own), and refuses
 * neither with an audited 403. Amounts never (3.4d).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemTime } from '@/app-layer/usecases/time-entry';
import { WorkItemTimeQuerySchema } from '@/lib/schemas/time-entry';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (req: NextRequest, { params }, ctx) => {
        const query = WorkItemTimeQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getWorkItemTime(ctx, params.workItemId, query));
    }),
);
