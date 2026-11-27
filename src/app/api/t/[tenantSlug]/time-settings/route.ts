/**
 * The workspace's time tracking settings (sub-phase 3.4c; owner decisions
 * 268 and 269; ADR 0012 §5).
 *
 *   - GET: "Timesheets need approval" and the recipient list told of
 *     submitted weeks (`time.view`).
 *   - PUT: change them (`admin.manage`: an Owner or Admin, or a custom role
 *     granting it); the currency (3.4d) also asks `time.rates` in the usecase.
 *     `If-Match` optional. Audited `TIME_SETTINGS_SET`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTimeSettings, setTimeSettings } from '@/app-layer/usecases/timesheet';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { TimeSettingsSchema } from '@/lib/schemas/timesheet';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('time.view', async (_req: NextRequest, _args, ctx) => jsonResponse(await getTimeSettings(ctx))),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, TimeSettingsSchema);
        return jsonResponse(await setTimeSettings(ctx, input, expectedVersionFrom(req)));
    }),
);
