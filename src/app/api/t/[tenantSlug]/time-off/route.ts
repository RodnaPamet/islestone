/**
 * One person's time off in a window (sub-phase 3.5a; owner decisions 286,
 * 287 and 298): `?from&to&userId` under `workload.view`, at most 366 days and
 * 2,000 dates (422 `TIME_OFF_TOO_LARGE`). Each date's hours (NULL: whole day)
 * and version; its `type` only for the person and holders of
 * `workload.manage` (decision 287), the key absent otherwise.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listTimeOff } from '@/app-layer/usecases/time-off';
import { TimeOffQuerySchema } from '@/lib/schemas/workload';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.view', async (req: NextRequest, _args, ctx) => {
        const query = TimeOffQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listTimeOff(ctx, query));
    }),
);
