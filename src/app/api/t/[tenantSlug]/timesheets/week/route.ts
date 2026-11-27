/**
 * A person's week as My time's status line reads it (sub-phase 3.4c; owner
 * decisions 266, 268 and 270): the switch, the timesheet (none: not
 * submitted), the sums, whether a timer counts in it, and what the caller may
 * do. `?week=YYYY-MM-DD[&userId=]`: one's own under `time.track`; another
 * member's also asks `time.approve`, refused in the usecase with an audited 403.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTimesheetWeek } from '@/app-layer/usecases/timesheet';
import { TimesheetWeekQuerySchema } from '@/lib/schemas/timesheet';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const query = TimesheetWeekQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getTimesheetWeek(ctx, query));
    }),
);
