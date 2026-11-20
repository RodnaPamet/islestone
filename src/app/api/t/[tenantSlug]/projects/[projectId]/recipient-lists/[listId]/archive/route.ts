/**
 * Archive one of a project's recipient lists (sub-phase 2.7e; `projects.edit`;
 * decision 141: archived, never deleted).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { archiveRecipientList } from '@/app-layer/usecases/recipient-list';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string; listId: string }>('projects.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await archiveRecipientList(ctx, params.projectId, params.listId));
    }),
);
