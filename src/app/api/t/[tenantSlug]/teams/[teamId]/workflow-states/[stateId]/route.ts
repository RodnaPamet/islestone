/**
 * One workflow state: rename, reorder, archive, make default (PATCH); delete,
 * moving its items to `?moveToStateId=` (DELETE). The category never changes.
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings until the owner decides
 * otherwise; see src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteWorkflowState, updateWorkflowState } from '@/app-layer/usecases/workflow-state';
import { DeleteWorkflowStateSchema, UpdateWorkflowStateSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string; stateId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateWorkflowStateSchema);
        return jsonResponse(await updateWorkflowState(ctx, params.stateId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; teamId: string; stateId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = DeleteWorkflowStateSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await deleteWorkflowState(ctx, params.stateId, input));
    }),
);
