/**
 * Restore a deleted work item with everything deleted together with it.
 * The key equals the DELETE it undoes, so a refusal is audited. Copied from
 * inflect-compliance's `tasks/[taskId]/restore/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreWorkItem } from '@/app-layer/usecases/work-item';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.delete', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreWorkItem(ctx, params.workItemId));
    }),
);
