/**
 * The roadmap (sub-phase 3.2c; docs/porting/maps/3.2.md, "The read"; owner
 * decisions 215 to 217): initiatives (or goals, `groupBy=goal`) and their
 * projects with derived bars, due dates as diamonds and the "No dates" rows,
 * under `goals.view`; the usecase asks `projects.view` too.
 * `?goalId=&initiativeId=&teamId=&leadUserId=&health=&status=&archived=&groupBy=`.
 * More than 500 projects is 422 `ROADMAP_TOO_LARGE` with the count.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getRoadmap } from '@/app-layer/usecases/roadmap';
import { RoadmapQuerySchema } from '@/lib/schemas/goal';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('goals.view', async (req: NextRequest, _args, ctx) => {
        const q = RoadmapQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getRoadmap(ctx, q));
    }),
);
