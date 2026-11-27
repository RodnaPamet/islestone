/**
 * Throughput (roadmap 3.6a; docs/porting/maps/3.6.md, "Throughput"): items
 * completed per day or ISO week of a window of at most 366 days (400
 * `ANALYTICS_RANGE`), at most 50,000 completions (422 `ANALYTICS_TOO_LARGE`
 * with the count, never cut). Read-gated on `analytics.view` (owner decision
 * 329). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getThroughput } from '@/app-layer/usecases/analytics';
import { ThroughputQuerySchema, analyticsFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        const { bin } = ThroughputQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getThroughput(ctx, { ...analyticsFiltersOf(req.nextUrl.searchParams), bin }));
    }),
);
