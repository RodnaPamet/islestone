/**
 * Resolve a key such as `ISL-123`: the current prefix, a retired one, or an
 * alias left by a move. `redirected` tells the client to rewrite an old key's
 * URL to `canonicalKey`. Unknown and invisible keys are the same 404.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemByKey } from '@/app-layer/usecases/work-item';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; key: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getWorkItemByKey(ctx, decodeURIComponent(params.key)));
    }),
);
