/**
 * Remove a billable rate whose date has not come (sub-phase 3.4d; owner
 * decision 273): `time.rates`; 409 `RATE_IN_FORCE` once it has applied.
 * Audited `BILLABLE_RATE_REMOVED`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeBillableRate } from '@/app-layer/usecases/billable-rate';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; rateId: string }>('time.rates', async (_req: NextRequest, { params }, ctx) => {
        await removeBillableRate(ctx, params.rateId);
        return jsonResponse({ deleted: true });
    }),
);
