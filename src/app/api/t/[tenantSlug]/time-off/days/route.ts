/**
 * Record or replace dates of time off (sub-phase 3.5a; owner decisions 286 to
 * 288, 300 and 303): `{ userId?, days: [{ day, minutes, type, version? }] }`
 * under `workload.time_off`; another member's asks `workload.manage` in the
 * usecase (audited 403 `WORKLOAD_MANAGE_REQUIRED`); a person only; all or
 * nothing (409 `VERSION_CONFLICT` naming the dates); audited `TIME_OFF_SET`
 * with dates and hours, never a type; the bell when the writer is not the
 * person.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setTimeOffDays } from '@/app-layer/usecases/time-off';
import { SetTimeOffDaysSchema } from '@/lib/schemas/workload';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.time_off', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, SetTimeOffDaysSchema);
        return jsonResponse(await setTimeOffDays(ctx, input));
    }),
);
