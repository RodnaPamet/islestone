/**
 * One work item type: rename, icon, colour, archive, reorder.
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings; owner decision
 * 2026-11-19, src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { updateWorkItemType } from '@/app-layer/usecases/work-item-type';
import { UpdateWorkItemTypeSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; typeId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateWorkItemTypeSchema);
        return jsonResponse(await updateWorkItemType(ctx, params.typeId, input));
    }),
);
