/**
 * A work item's live sub-items in manual order, cursor-paginated;
 * `?progress=1` adds done/total per sub-item. A sub-item is created with the
 * ordinary POST /work-items and a `parentId`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listSubItems } from '@/app-layer/usecases/work-item';
import { PageQuerySchema } from '@/lib/schemas/work-item';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (req: NextRequest, { params }, ctx) => {
        const page = PageQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const progress = req.nextUrl.searchParams.get('progress') === '1';
        return jsonResponse(await listSubItems(ctx, params.workItemId, { ...page, progress }));
    }),
);
