/**
 * A project's milestones (sub-phase 2.5b): list with progress
 * (`projects.view`) and create (`projects.edit`; owner decision 72).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createMilestone, listMilestones } from '@/app-layer/usecases/milestone';
import { CreateMilestoneSchema } from '@/lib/schemas/milestone';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listMilestones(ctx, params.projectId));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CreateMilestoneSchema);
        return jsonResponse(await createMilestone(ctx, params.projectId, input), { status: 201 });
    }),
);
