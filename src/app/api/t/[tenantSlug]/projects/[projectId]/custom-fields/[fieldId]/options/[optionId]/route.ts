/**
 * One option of a select field (sub-phase 2.4, `projects.edit`): rename,
 * recolour, archive; delete only while no value holds it (409 `OPTION_IN_USE`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteCustomFieldOption, updateCustomFieldOption } from '@/app-layer/usecases/custom-field';
import { UpdateCustomFieldOptionSchema } from '@/lib/schemas/custom-field';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string; fieldId: string; optionId: string };

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateCustomFieldOptionSchema);
        return jsonResponse(await updateCustomFieldOption(ctx, params.projectId, params.fieldId, params.optionId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteCustomFieldOption(ctx, params.projectId, params.fieldId, params.optionId));
    }),
);
