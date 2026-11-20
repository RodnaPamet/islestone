/** New intake requests per visible project, for the sidebar's count (sub-phase 2.6a). Key `intake.view`. */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { countPendingIntake } from '@/app-layer/usecases/intake-request';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.view', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await countPendingIntake(ctx));
    }),
);
