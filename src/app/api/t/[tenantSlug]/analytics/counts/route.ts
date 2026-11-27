/**
 * Analytics counts (roadmap 3.6a; docs/porting/maps/3.6.md, "Reads, routes
 * and keys"): open and started items now, and the items completed and
 * created in the window, over the list's filters. Read-gated on
 * `analytics.view` (owner decision 329); project visibility narrows every
 * read. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getAnalyticsCounts } from '@/app-layer/usecases/analytics';
import { analyticsFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        return jsonResponse(await getAnalyticsCounts(ctx, analyticsFiltersOf(req.nextUrl.searchParams)));
    }),
);
