/**
 * One member's submitted or decided week with its entries, read-only
 * (sub-phase 3.4c; owner decision 266: a person's whole week to
 * `time.approve`), and what the approver may do with it. Key: `time.approve`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTimesheet } from '@/app-layer/usecases/timesheet';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timesheetId: string }>('time.approve', async (_req: NextRequest, { params }, ctx) =>
        jsonResponse(await getTimesheet(ctx, params.timesheetId)),
    ),
);
