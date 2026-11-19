/**
 * A work item's Activity: its audit entries and comments, newest first,
 * cursor-paginated. Copied from inflect-compliance's
 * `tasks/[taskId]/activity/route.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemActivity } from '@/app-layer/usecases/work-item';
import { PageQuerySchema } from '@/lib/schemas/work-item';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (req: NextRequest, { params }, ctx) => {
        const page = PageQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getWorkItemActivity(ctx, params.workItemId, page));
    }),
);
