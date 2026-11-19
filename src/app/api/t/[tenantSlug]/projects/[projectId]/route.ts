/**
 * One project: read, rename or re-prefix, delete (soft; its items are hidden
 * with it and come back on restore).
 *
 * Keys: `projects.view` to read, `projects.create`, `projects.edit` (rename,
 * prefix), and `projects.archive` for archive, delete and restore.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteProject, getProject, updateProject } from '@/app-layer/usecases/project';
import { UpdateProjectSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getProject(ctx, params.projectId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateProjectSchema);
        return jsonResponse(await updateProject(ctx, params.projectId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.archive', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteProject(ctx, params.projectId));
    }),
);
