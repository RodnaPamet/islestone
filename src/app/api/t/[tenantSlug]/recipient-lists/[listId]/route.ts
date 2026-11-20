/**
 * One workspace recipient list (sub-phase 2.7e): read it (`projects.view`),
 * rename it or change its description (`admin.manage`, decision 140). A list
 * is never deleted (decision 141): see `archive` and `restore`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getRecipientList, updateRecipientList } from '@/app-layer/usecases/recipient-list';
import { UpdateRecipientListSchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; listId: string };

export const GET = withApiErrorHandling(
    requirePermission<Params>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getRecipientList(ctx, null, params.listId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateRecipientListSchema);
        return jsonResponse(await updateRecipientList(ctx, null, params.listId, input));
    }),
);
