/**
 * Archive or unarchive a project (`{ archived }`).
 *
 * Keys: `projects.view` to read, `projects.create`, `projects.edit` (rename,
 * prefix), and `projects.archive` for archive, delete and restore.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setProjectArchived } from '@/app-layer/usecases/project';
import { ArchiveProjectSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.archive', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, ArchiveProjectSchema);
        return jsonResponse(await setProjectArchived(ctx, params.projectId, input.archived));
    }),
);
