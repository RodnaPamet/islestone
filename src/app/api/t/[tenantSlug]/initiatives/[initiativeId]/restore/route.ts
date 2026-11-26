/**
 * Restore a deleted initiative (sub-phase 3.2a, decision 218). Key:
 * `goals.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreInitiative } from '@/app-layer/usecases/initiative';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; initiativeId: string }>('goals.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreInitiative(ctx, params.initiativeId));
    }),
);
