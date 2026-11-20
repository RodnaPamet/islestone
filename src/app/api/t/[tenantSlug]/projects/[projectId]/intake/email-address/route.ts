/**
 * Generate a new email address for a project's intake (sub-phase 2.6c): the
 * old address, and every reply address built on it, stops working at once.
 * Key `intake.manage` (decision 92).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { rotateProjectIntakeAddress } from '@/app-layer/usecases/intake-settings';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('intake.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await rotateProjectIntakeAddress(ctx, params.projectId));
    }),
);
