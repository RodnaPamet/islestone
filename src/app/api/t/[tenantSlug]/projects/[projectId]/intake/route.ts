/**
 * A project's intake (sub-phase 2.6a; owner decisions 93 and 95): turn it on
 * or off and set its notify list. Key `intake.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { SetProjectIntakeSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('intake.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetProjectIntakeSchema);
        return jsonResponse(await setProjectIntake(ctx, params.projectId, input));
    }),
);
