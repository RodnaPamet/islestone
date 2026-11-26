/**
 * A cycle's burn-up (sub-phase 2.5a, owner decisions 65 and 66): scope,
 * started and completed per day, from the transition record, over the items
 * the caller can see. From 3.4a (decision 259) `?measure=points|hours` sums
 * the estimates the transitions record instead of counting items, while the
 * cycle's team estimates in that unit (400 `MEASURE_UNAVAILABLE` otherwise).
 * Key: `cycles.view`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getCycleBurnUp } from '@/app-layer/usecases/cycle';
import { BurnUpQuerySchema } from '@/lib/schemas/cycle';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; cycleId: string }>('cycles.view', async (req: NextRequest, { params }, ctx) => {
        const query = BurnUpQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getCycleBurnUp(ctx, params.cycleId, new Date(), query.measure));
    }),
);
