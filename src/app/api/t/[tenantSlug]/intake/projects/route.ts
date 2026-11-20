/** Every visible project's intake, notify list and new requests, for Settings → Intake (sub-phase 2.6a). Key `intake.manage`. */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listProjectIntakeSettings } from '@/app-layer/usecases/intake-settings';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.manage', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listProjectIntakeSettings(ctx));
    }),
);
