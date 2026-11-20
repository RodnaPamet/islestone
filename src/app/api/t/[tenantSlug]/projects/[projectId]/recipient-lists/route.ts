/**
 * A project's recipient lists (sub-phase 2.7e; owner decisions 138 to 142):
 * list them (`projects.view`, `?includeArchived=1`) and create one
 * (`projects.edit`, decision 140: a project's lists are part of it).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createRecipientList, listProjectRecipientLists } from '@/app-layer/usecases/recipient-list';
import { CreateRecipientListSchema, ListProjectRecipientListsQuerySchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string };

export const GET = withApiErrorHandling(
    requirePermission<Params>('projects.view', async (req: NextRequest, { params }, ctx) => {
        const q = ListProjectRecipientListsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listProjectRecipientLists(ctx, params.projectId, { includeArchived: q.includeArchived === '1' }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CreateRecipientListSchema);
        return jsonResponse(await createRecipientList(ctx, params.projectId, input), { status: 201 });
    }),
);
