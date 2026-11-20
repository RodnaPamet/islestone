/**
 * Aim a work item at a milestone of its project, or clear it (sub-phase
 * 2.5b). A single-field change: `If-Match` optional (ADR 0002 §9). Key:
 * `work_items.edit`, as the other single-field changes.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemMilestone } from '@/app-layer/usecases/milestone';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemMilestoneSchema } from '@/lib/schemas/milestone';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemMilestoneSchema);
        return jsonResponse(await setWorkItemMilestone(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
