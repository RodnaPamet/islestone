/**
 * Take one's own submitted week back before it is decided (sub-phase 3.4c;
 * owner decision 270): WITHDRAWN, its entries open again. `If-Match`
 * optional. Another person's week is a 404. Key: `time.track`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { withdrawTimesheet } from '@/app-layer/usecases/timesheet';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timesheetId: string }>('time.track', async (req: NextRequest, { params }, ctx) =>
        jsonResponse(await withdrawTimesheet(ctx, params.timesheetId, expectedVersionFrom(req))),
    ),
);
