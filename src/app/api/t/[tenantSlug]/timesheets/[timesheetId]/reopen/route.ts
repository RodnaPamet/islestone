/**
 * Reopen a member's approved week with an explanation (sub-phase 3.4c; owner
 * decision 270): RETURNED again, its entries open, audited and notified.
 * Anyone holding `time.approve`, never on their own week, a person only.
 * `If-Match` optional.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { reopenTimesheet } from '@/app-layer/usecases/timesheet';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { TimesheetExplanationSchema } from '@/lib/schemas/timesheet';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timesheetId: string }>('time.approve', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, TimesheetExplanationSchema);
        return jsonResponse(await reopenTimesheet(ctx, params.timesheetId, input, expectedVersionFrom(req)));
    }),
);
