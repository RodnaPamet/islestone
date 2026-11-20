/**
 * Put a work item in a cycle of its team, or take it out (sub-phase 2.5a).
 * A single-field change: `If-Match` optional (ADR 0002 §9). Key:
 * `work_items.edit`, as the other single-field changes.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemCycle } from '@/app-layer/usecases/cycle';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemCycleSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemCycleSchema);
        return jsonResponse(await setWorkItemCycle(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
