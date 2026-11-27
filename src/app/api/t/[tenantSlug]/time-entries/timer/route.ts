/**
 * The caller's timer (sub-phase 3.4b; owner decisions 262 and 263).
 *
 *   - GET: the running timer with its item, or `{ timer: null }`; the top
 *     chrome reads it on window focus.
 *   - POST `{ workItemId, timeZone }`: start one, stopping and recording the
 *     timer that was on; it counts on today's date in the browser's zone. A
 *     race of two starts is 409 `TIMER_ON`.
 *
 * Key: `time.track`. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getRunningTimer, startTimer } from '@/app-layer/usecases/time-entry';
import { StartTimerSchema } from '@/lib/schemas/time-entry';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await getRunningTimer(ctx));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, StartTimerSchema);
        return jsonResponse(await startTimer(ctx, input), { status: 201 });
    }),
);
