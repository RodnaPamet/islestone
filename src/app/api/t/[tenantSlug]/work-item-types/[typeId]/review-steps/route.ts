/**
 * A work item type's default review steps and its Done check (sub-phase
 * 2.8c; ADR 0009 §14 and §15; owner decisions 149, 159 and 160). Keys: reads
 * take `projects.view`; a change takes `admin.manage`, as the type itself.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getTypeReviewSteps, setTypeReviewSteps } from '@/app-layer/usecases/review-defaults';
import { SetTypeReviewStepsSchema } from '@/lib/schemas/review';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; typeId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getTypeReviewSteps(ctx, params.typeId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; typeId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetTypeReviewStepsSchema);
        return jsonResponse(await setTypeReviewSteps(ctx, params.typeId, input));
    }),
);
