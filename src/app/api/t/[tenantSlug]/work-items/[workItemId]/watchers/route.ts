/**
 * A work item's watchers. GET lists them; POST and DELETE make THE CALLER
 * watch or stop watching (`work_items.view`, no body). Watching another member
 * is `watchers/[userId]`, under `work_items.edit`, so a refused "watch someone
 * else" is an audited `requirePermission` denial. Split from
 * inflect-compliance's `tasks/[taskId]/watchers/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, which escalated inside the usecase
 * and so wrote no denial row.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listWatchers, unwatchWorkItem, watchWorkItem } from '@/app-layer/usecases/work-item-collab';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listWatchers(ctx, params.workItemId));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await watchWorkItem(ctx, params.workItemId));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await unwatchWorkItem(ctx, params.workItemId));
    }),
);
