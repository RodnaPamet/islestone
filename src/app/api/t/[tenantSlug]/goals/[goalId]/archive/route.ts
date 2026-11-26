/**
 * Archive a Completed or Cancelled goal, or unarchive it (sub-phase 3.2a,
 * decision 218). Key: `goals.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setGoalArchived } from '@/app-layer/usecases/goal';
import { SetArchivedSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; goalId: string }>('goals.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetArchivedSchema);
        return jsonResponse(await setGoalArchived(ctx, params.goalId, input.archived));
    }),
);
