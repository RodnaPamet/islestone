/**
 * A work item's links (a URL, pull request or commit): list and add. Copied
 * from inflect-compliance's `tasks/[taskId]/links/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (`{ type, location, title }`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addWorkItemLink, listWorkItemLinks } from '@/app-layer/usecases/work-item-collab';
import { AddWorkItemLinkSchema } from '@/lib/schemas/work-item';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listWorkItemLinks(ctx, params.workItemId));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddWorkItemLinkSchema);
        return jsonResponse(await addWorkItemLink(ctx, params.workItemId, input), { status: 201 });
    }),
);
