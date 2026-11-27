/**
 * Stop the caller's timer (sub-phase 3.4b; owner decision 263): the whole
 * minutes since it started, rounded to the nearest, at most 12 hours, or
 * fewer when `minutes` says so; under 30 seconds it is discarded. 409
 * `TIMER_OFF` when none is on. Key: `time.track`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { stopTimer } from '@/app-layer/usecases/time-entry';
import { StopTimerSchema } from '@/lib/schemas/time-entry';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, StopTimerSchema);
        return jsonResponse(await stopTimer(ctx, input));
    }),
);
