/**
 * One label: rename or recolour; delete (detached from every item first).
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings; owner decision
 * 2026-11-19, src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteLabel, updateLabel } from '@/app-layer/usecases/label';
import { UpdateLabelSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; labelId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateLabelSchema);
        return jsonResponse(await updateLabel(ctx, params.labelId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; labelId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteLabel(ctx, params.labelId));
    }),
);
