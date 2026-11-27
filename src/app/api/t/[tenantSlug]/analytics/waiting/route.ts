/**
 * Time waiting (roadmap 3.6b; docs/porting/maps/3.6.md, "Time waiting";
 * owner decisions 76, 317 and 329): the totals and the caller's own row for
 * every holder of `analytics.view`; every party's row only with
 * `analytics.people` (the key absent, the rows absent). At most 20,000 items
 * followed (422 `ANALYTICS_TOO_LARGE`). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTimeWaiting } from '@/app-layer/usecases/analytics-waiting';
import { analyticsFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        return jsonResponse(await getTimeWaiting(ctx, analyticsFiltersOf(req.nextUrl.searchParams)));
    }),
);
