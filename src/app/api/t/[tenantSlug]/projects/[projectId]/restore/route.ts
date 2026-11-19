/**
 * Restore a deleted project, with its items as they were.
 *
 * Keys: `projects.view` to read, `projects.create`, `projects.edit` (rename,
 * prefix), and `projects.archive` for archive, delete and restore.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreProject } from '@/app-layer/usecases/project';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.archive', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreProject(ctx, params.projectId));
    }),
);
