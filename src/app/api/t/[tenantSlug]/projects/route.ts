/**
 * Projects: list (`?teamId=`, `?includeArchived=1`) and create.
 *
 * Keys: `projects.view` to read, `projects.create`, `projects.edit` (rename,
 * prefix), and `projects.archive` for archive, delete and restore.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createProject, listProjects } from '@/app-layer/usecases/project';
import { CreateProjectSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (req: NextRequest, _args, ctx) => {
        const teamId = req.nextUrl.searchParams.get('teamId') ?? undefined;
        const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
        return jsonResponse(await listProjects(ctx, { teamId, includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.create', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateProjectSchema);
        return jsonResponse(await createProject(ctx, input), { status: 201 });
    }),
);
