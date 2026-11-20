/**
 * Name the active member a work item waits on, or nobody (sub-phase 2.4b;
 * ADR 0002 §14; owner decisions 103 to 105). A single-field change:
 * `If-Match` optional (ADR 0002 §9). Key: `work_items.edit`, as an item's
 * cycle and milestone. A closed item is refused (409 `ITEM_CLOSED`).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setWorkItemWaitingOn } from '@/app-layer/usecases/work-item';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetWorkItemWaitingOnSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetWorkItemWaitingOnSchema);
        return jsonResponse(await setWorkItemWaitingOn(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
