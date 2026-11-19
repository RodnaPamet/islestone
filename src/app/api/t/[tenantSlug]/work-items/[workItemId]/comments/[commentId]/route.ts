/**
 * Edit a comment (its author only) or delete it (its author, or a workspace
 * admin as moderation; owner decision 2026-11-19). A refusal past the route
 * key writes an `AUTHZ_DENIED` row from the usecase. A delete is soft.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteComment, editComment } from '@/app-layer/usecases/work-item-collab';
import { AddCommentSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; commentId: string }>('work_items.comment', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddCommentSchema);
        return jsonResponse(await editComment(ctx, params.workItemId, params.commentId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; commentId: string }>('work_items.comment', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteComment(ctx, params.workItemId, params.commentId));
    }),
);
