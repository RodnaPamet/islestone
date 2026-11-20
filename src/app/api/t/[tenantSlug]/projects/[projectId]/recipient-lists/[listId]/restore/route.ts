/**
 * Restore one of a project's archived recipient lists (sub-phase 2.7e;
 * `projects.edit`, decision 141).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreRecipientList } from '@/app-layer/usecases/recipient-list';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string; listId: string }>('projects.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreRecipientList(ctx, params.projectId, params.listId));
    }),
);
