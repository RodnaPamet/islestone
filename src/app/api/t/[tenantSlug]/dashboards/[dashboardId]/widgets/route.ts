/**
 * A dashboard's widgets (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Editing"; owner decisions 326 to 328): the whole list replaced in one
 * transaction on the version the caller read (`If-Match` required, 428
 * without; 409 `VERSION_CONFLICT` with the server's dashboard), at most 24
 * widgets, each configuration parsed. Its creator only (`analytics.share` for
 * a shared one), decided and audited by the usecase. Written fresh for
 * Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setDashboardWidgets } from '@/app-layer/usecases/dashboard';
import { SetDashboardWidgetsSchema } from '@/lib/schemas/dashboard';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; dashboardId: string }>('analytics.view', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetDashboardWidgetsSchema);
        return jsonResponse(await setDashboardWidgets(ctx, params.dashboardId, input.widgets, expectedVersionFrom(req)));
    }),
);
