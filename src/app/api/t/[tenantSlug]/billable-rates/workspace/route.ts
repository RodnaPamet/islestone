/**
 * The workspace's billable rate from a date (sub-phase 3.4d; owner decisions
 * 272 and 273): `time.rates`; a date's row is replaced. Audited
 * `BILLABLE_RATE_SET`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkspaceRate } from '@/app-layer/usecases/billable-rate';
import { SetBillableRateSchema } from '@/lib/schemas/billable-rate';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.rates', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, SetBillableRateSchema);
        return jsonResponse(await setWorkspaceRate(ctx, input));
    }),
);
