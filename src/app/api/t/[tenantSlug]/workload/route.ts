/**
 * The Workload page's read (sub-phase 3.5a: capacity per person per week;
 * 3.5b adds allocation; docs/porting/maps/3.5.md, "The read"; owner decisions
 * 284 to 286 and 298). `?from=YYYY-MM-DD&weeks=1..26&userId=` under
 * `workload.view`; never a time-off type.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkload } from '@/app-layer/usecases/workload';
import { WorkloadQuerySchema } from '@/lib/schemas/workload';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.view', async (req: NextRequest, _args, ctx) => {
        const query = WorkloadQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getWorkload(ctx, query));
    }),
);
