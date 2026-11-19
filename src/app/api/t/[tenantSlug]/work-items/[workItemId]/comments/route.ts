/**
 * A work item's comments: list (newest first, cursor-paginated) and add.
 * Bodies are sanitised and stored encrypted. Copied from inflect-compliance's
 * `tasks/[taskId]/comments/route.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addComment, listComments } from '@/app-layer/usecases/work-item-collab';
import { AddCommentSchema, PageQuerySchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (req: NextRequest, { params }, ctx) => {
        const page = PageQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listComments(ctx, params.workItemId, page));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.comment', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddCommentSchema);
        return jsonResponse(await addComment(ctx, params.workItemId, input), { status: 201 });
    }),
);
