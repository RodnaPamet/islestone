/**
 * Time totals (sub-phase 3.4d; owner decisions 266 and 274): finished
 * entries over a window of at most 366 days, grouped by project, person,
 * item or week (`time.view`); amounts only for `time.rates`. Not audited.
 *
 *   GET `?from&to&groupBy=project|person|item|week[&projectId][&userId][&billable]`
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTimeTotals } from '@/app-layer/usecases/time-totals';
import { TimeTotalsQuerySchema } from '@/lib/schemas/billable-rate';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.view', async (req: NextRequest, _args, ctx) => {
        const { groupBy, ...filter } = TimeTotalsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getTimeTotals(ctx, { filter, groupBy }));
    }),
);
