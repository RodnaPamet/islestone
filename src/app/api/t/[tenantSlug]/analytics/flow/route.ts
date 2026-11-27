/**
 * Cumulative flow and the burn-up for any scope (roadmap 3.6a;
 * docs/porting/maps/3.6.md, "Cumulative flow", "The burn-up, for any
 * scope"): at most 20,000 items followed (422 `ANALYTICS_TOO_LARGE`),
 * `MEASURE_UNAVAILABLE` as the cycle burn-up's. Read-gated on
 * `analytics.view` (owner decision 329). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getFlow } from '@/app-layer/usecases/analytics';
import { FlowQuerySchema, analyticsFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        const { burnUp, measure } = FlowQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getFlow(ctx, { ...analyticsFiltersOf(req.nextUrl.searchParams), burnUp: burnUp === '1', measure }));
    }),
);
