/**
 * The items that fill one person's week on the Workload page (sub-phase 3.5b;
 * docs/porting/maps/3.5.md, "The read"; owner decisions 292 to 298).
 * `?userId=<id>|me|unassigned&week=YYYY-MM-DD` under `workload.view`: the
 * week's capacity, allocation and time-off dates with their hours (never a
 * type), and its items, most minutes first, at most 200, listed only for a
 * caller who may read work items; for an over-capacity week, the ways to
 * rebalance it (3.5c, decision 299), for a person who could act on them.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkloadCell } from '@/app-layer/usecases/workload';
import { WorkloadCellQuerySchema } from '@/lib/schemas/workload';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.view', async (req: NextRequest, _args, ctx) => {
        const query = WorkloadCellQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getWorkloadCell(ctx, query));
    }),
);
