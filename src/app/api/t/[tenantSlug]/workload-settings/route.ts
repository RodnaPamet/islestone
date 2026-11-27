/**
 * The workspace's workload settings (sub-phase 3.5a; owner decision 284).
 *
 *   - GET (`workload.view`): the default weekly capacity, 40 hours while no
 *     row is saved (`version` 0).
 *   - PUT (`workload.manage`, a person): `{ defaultWeeklyMinutes }`, 0 to
 *     6,000; `If-Match` the version read (409 `VERSION_CONFLICT`); audited
 *     `WORKLOAD_SETTINGS_SET`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkloadSettings, setWorkloadSettings } from '@/app-layer/usecases/workload-capacity';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { WorkloadSettingsSchema } from '@/lib/schemas/workload';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.view', async (_req: NextRequest, _args, ctx) => jsonResponse(await getWorkloadSettings(ctx))),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, WorkloadSettingsSchema);
        return jsonResponse(await setWorkloadSettings(ctx, input, expectedVersionFrom(req)));
    }),
);
