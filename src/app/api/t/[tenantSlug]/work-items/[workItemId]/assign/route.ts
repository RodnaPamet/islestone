/**
 * Assign a work item to an active member, or clear its assignee. Copied from
 * inflect-compliance's `tasks/[taskId]/assign/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (`{ assigneeId }`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { assignWorkItem } from '@/app-layer/usecases/work-item';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { AssignWorkItemSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.assign', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AssignWorkItemSchema);
        return jsonResponse(await assignWorkItem(ctx, params.workItemId, input, expectedVersionFrom(req)));
    }),
);
