/**
 * A team's workflow states: list (`?includeArchived=1`) and create.
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings until the owner decides
 * otherwise; see src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createWorkflowState, listWorkflowStates } from '@/app-layer/usecases/workflow-state';
import { CreateWorkflowStateSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('projects.view', async (req: NextRequest, { params }, ctx) => {
        const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
        return jsonResponse(await listWorkflowStates(ctx, params.teamId, { includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CreateWorkflowStateSchema);
        return jsonResponse(await createWorkflowState(ctx, params.teamId, input), { status: 201 });
    }),
);
