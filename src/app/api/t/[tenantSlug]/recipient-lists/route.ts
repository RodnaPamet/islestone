/**
 * Recipient lists (sub-phase 2.7e; owner decisions 138 to 142). GET lists the
 * workspace's lists (`?includeArchived=1`), or the live lists usable on one
 * project's items (`?projectId=`: the workspace's and the project's) or on any
 * visible project's (`?usable=1`), under `projects.view`. POST creates a
 * workspace list under `admin.manage` (decision 140); a project's lists are
 * created under `/projects/:projectId/recipient-lists`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createRecipientList, listRecipientLists } from '@/app-layer/usecases/recipient-list';
import { CreateRecipientListSchema, ListRecipientListsQuerySchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (req: NextRequest, _args, ctx) => {
        const q = ListRecipientListsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listRecipientLists(ctx, { projectId: q.projectId, usable: q.usable === '1', includeArchived: q.includeArchived === '1' }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateRecipientListSchema);
        return jsonResponse(await createRecipientList(ctx, null, input), { status: 201 });
    }),
);
