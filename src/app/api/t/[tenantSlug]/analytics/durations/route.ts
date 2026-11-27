/**
 * Cycle time, lead time and age (roadmap 3.6a; docs/porting/maps/3.6.md,
 * "Cycle time and lead time", "Age"): nearest-rank percentiles over every
 * completion in the window, the newest 2,000 as points, and the oldest 2,000
 * open, started items' age. Read-gated on `analytics.view` (owner decision
 * 329). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getDurations } from '@/app-layer/usecases/analytics';
import { DurationsQuerySchema, analyticsFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        const { measure } = DurationsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getDurations(ctx, { ...analyticsFiltersOf(req.nextUrl.searchParams), measure }));
    }),
);
