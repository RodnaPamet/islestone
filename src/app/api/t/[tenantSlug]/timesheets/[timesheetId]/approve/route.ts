/**
 * Approve a member's submitted week (sub-phase 3.4c; owner decisions 256 and
 * 269): anyone holding `time.approve`, never on their own week (an audited
 * 403 `OWN_TIMESHEET`), a person only. `If-Match` optional.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { approveTimesheet } from '@/app-layer/usecases/timesheet';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timesheetId: string }>('time.approve', async (req: NextRequest, { params }, ctx) =>
        jsonResponse(await approveTimesheet(ctx, params.timesheetId, expectedVersionFrom(req))),
    ),
);
