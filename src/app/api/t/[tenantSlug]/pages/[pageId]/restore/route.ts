/**
 * Restore a deleted page's group: the pages deleted with it (sub-phase 4.1a,
 * decision 344). Key: `pages.delete`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restorePage } from '@/app-layer/usecases/page';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; pageId: string }>('pages.delete', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restorePage(ctx, params.pageId));
    }),
);
