/**
 * One dashboard (sub-phase 3.6d; owner decisions 326 and 329): read it
 * (another person's personal one is a 404), rename or share it (its creator,
 * `analytics.share` for a shared one; `If-Match` checked when sent), delete
 * it (its creator, or an Owner or Admin for a shared one, audited
 * `DASHBOARD_MODERATED`). The route's key is `analytics.view`; the usecase
 * decides the rest and audits a refusal. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteDashboard, getDashboard, updateDashboard } from '@/app-layer/usecases/dashboard';
import { UpdateDashboardSchema } from '@/lib/schemas/dashboard';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; dashboardId: string }>('analytics.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getDashboard(ctx, params.dashboardId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; dashboardId: string }>('analytics.view', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateDashboardSchema);
        return jsonResponse(await updateDashboard(ctx, params.dashboardId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; dashboardId: string }>('analytics.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteDashboard(ctx, params.dashboardId));
    }),
);
