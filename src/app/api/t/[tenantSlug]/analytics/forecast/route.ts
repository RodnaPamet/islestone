/**
 * The forecast (roadmap 3.6c; docs/porting/maps/3.6.md, "Forecasting"; ADR
 * 0014 §3 to §5): the dates by which a scope's open items are 50, 85 and 95
 * percent likely to be done, the chance by its due date, the distribution
 * and the scope's own record, over the list's filters; or a refusal with its
 * counts, as a 200, never a date. 422 `ANALYTICS_TOO_LARGE` above 50,000
 * completions in the history. Read-gated on `analytics.view` (owner decision
 * 329). Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getForecast } from '@/app-layer/usecases/analytics-forecast';
import { ForecastQuerySchema, forecastFiltersOf } from '@/lib/schemas/analytics';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('analytics.view', async (req: NextRequest, _args, ctx) => {
        const { historyWeeks, share, basedOn, historyProjectIds } = ForecastQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(
            await getForecast(ctx, {
                ...forecastFiltersOf(req.nextUrl.searchParams),
                historyWeeks: historyWeeks ? (Number(historyWeeks) as 4 | 8 | 12 | 26) : undefined,
                share: share ? Number(share) : undefined,
                basedOn,
                historyProjectIds: historyProjectIds ? historyProjectIds.split(',') : undefined,
            }),
        );
    }),
);
