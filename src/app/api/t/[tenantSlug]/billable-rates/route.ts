/**
 * Every billable rate of the workspace and its currency (sub-phase 3.4d;
 * owner decisions 272 to 274): `time.rates` only, the settings and project
 * pages' one read.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getBillableRates } from '@/app-layer/usecases/billable-rate';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.rates', async (_req: NextRequest, _args, ctx) => jsonResponse(await getBillableRates(ctx))),
);
