/**
 * Dashboards (sub-phase 3.6d; docs/porting/maps/3.6.md, "Reads, routes and
 * keys"; owner decisions 326 and 329): the caller's own dashboards and every
 * shared one, with the default described (`analytics.view`); save one
 * (`analytics.view`; a shared one also needs `analytics.share`, asked and
 * audited by the usecase). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createDashboard, listDashboards } from '@/app-layer/usecases/dashboard';
import { CreateDashboardSchema } from '@/lib/schemas/dashboard';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listDashboards(ctx));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateDashboardSchema);
        return jsonResponse(await createDashboard(ctx, input), { status: 201 });
    }),
);
