/**
 * Timesheets (sub-phase 3.4c; owner decisions 256, 268 and 269; ADR 0012 §5).
 *
 *   - GET `?status=SUBMITTED|DECIDED&cursor=`: the weeks waiting for a
 *     decision, oldest first, or those decided in the last 12 weeks
 *     (`time.approve`).
 *   - POST `{ week }`: submit one's own week, a person only (`time.track`;
 *     decision 278), while approval is on.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listTimesheets, submitTimesheet } from '@/app-layer/usecases/timesheet';
import { SubmitTimesheetSchema, TimesheetListQuerySchema } from '@/lib/schemas/timesheet';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.approve', async (req: NextRequest, _args, ctx) => {
        const query = TimesheetListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listTimesheets(ctx, query));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, SubmitTimesheetSchema);
        return jsonResponse(await submitTimesheet(ctx, input), { status: 201 });
    }),
);
