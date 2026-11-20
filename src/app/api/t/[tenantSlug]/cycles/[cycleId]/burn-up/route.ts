/**
 * A cycle's burn-up (sub-phase 2.5a, owner decisions 65 and 66): scope,
 * started and completed per day, from the transition record, over the items
 * the caller can see. Key: `cycles.view`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getCycleBurnUp } from '@/app-layer/usecases/cycle';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; cycleId: string }>('cycles.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getCycleBurnUp(ctx, params.cycleId));
    }),
);
