/**
 * Remove dates of time off for good (sub-phase 3.5a; owner decisions 288, 289
 * and 300): `{ userId?, days: [{ day, version }] }` under `workload.time_off`,
 * another member's asking `workload.manage`; sent from the undo toast;
 * audited `TIME_OFF_REMOVED` with dates and hours, never a type; the bell when
 * the writer is not the person.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeTimeOffDays } from '@/app-layer/usecases/time-off';
import { RemoveTimeOffDaysSchema } from '@/lib/schemas/workload';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.time_off', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, RemoveTimeOffDaysSchema);
        return jsonResponse(await removeTimeOffDays(ctx, input));
    }),
);
