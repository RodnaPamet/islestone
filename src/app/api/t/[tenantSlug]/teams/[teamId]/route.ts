/**
 * One team (with its workflow states): read, rename or set its estimate unit
 * (3.4a, decision 257), delete (refused while it has projects).
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings; owner decision
 * 2026-11-19, src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteTeam, getTeam, updateTeam } from '@/app-layer/usecases/team';
import { UpdateTeamSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getTeam(ctx, params.teamId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateTeamSchema);
        return jsonResponse(await updateTeam(ctx, params.teamId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteTeam(ctx, params.teamId));
    }),
);
