/**
 * One milestone (sub-phase 2.5b): rename, re-date or reorder by neighbour
 * (`PATCH`), and delete (its items leave it first). Key: `projects.edit`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteMilestone, updateMilestone } from '@/app-layer/usecases/milestone';
import { UpdateMilestoneSchema } from '@/lib/schemas/milestone';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string; milestoneId: string };

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateMilestoneSchema);
        return jsonResponse(await updateMilestone(ctx, params.projectId, params.milestoneId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteMilestone(ctx, params.projectId, params.milestoneId));
    }),
);
