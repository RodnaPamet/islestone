/**
 * Move a work item: reorder (`position`), re-parent (`parentId`, `null` for
 * the top level) or move to another project (`projectId`, with its whole
 * subtree; the destination's create gate is asked in the usecase). Exactly one
 * mode per request; `If-Match` is optional.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { moveWorkItemToProject, reorderWorkItem, reparentWorkItem } from '@/app-layer/usecases/work-item-moves';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { MoveWorkItemSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, MoveWorkItemSchema);
        if (input.projectId !== undefined) {
            return jsonResponse(await moveWorkItemToProject(ctx, params.workItemId, { projectId: input.projectId, position: input.position }));
        }
        if (input.parentId !== undefined) {
            return jsonResponse(
                await reparentWorkItem(ctx, params.workItemId, { parentId: input.parentId, position: input.position }, expectedVersionFrom(req)),
            );
        }
        return jsonResponse(await reorderWorkItem(ctx, params.workItemId, input.position ?? {}));
    }),
);
