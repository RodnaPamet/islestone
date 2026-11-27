/**
 * Time entries (sub-phase 3.4b; owner decisions 260 to 267; ADR 0012 §2).
 *
 *   - GET `?week=YYYY-MM-DD[&userId=]`: a person's Monday-to-Sunday week. One's
 *     own under `time.track`; another member's also asks `time.approve`
 *     (decision 266), refused in the usecase with an audited 403.
 *   - POST: add time to one work item by hand, a person only (decision 278).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addTimeEntry, getTimeWeek } from '@/app-layer/usecases/time-entry';
import { CreateTimeEntrySchema, TimeWeekQuerySchema } from '@/lib/schemas/time-entry';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const query = TimeWeekQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await getTimeWeek(ctx, query));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.track', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateTimeEntrySchema);
        return jsonResponse(await addTimeEntry(ctx, input), { status: 201 });
    }),
);
