/**
 * One of a project's recipient lists (sub-phase 2.7e): read it
 * (`projects.view`), rename it or change its description (`projects.edit`,
 * decision 140). Another scope's list is a 404 here.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getRecipientList, updateRecipientList } from '@/app-layer/usecases/recipient-list';
import { UpdateRecipientListSchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string; listId: string };

export const GET = withApiErrorHandling(
    requirePermission<Params>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getRecipientList(ctx, params.projectId, params.listId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateRecipientListSchema);
        return jsonResponse(await updateRecipientList(ctx, params.projectId, params.listId, input));
    }),
);
