/**
 * Add an option to a select or multi-select field (sub-phase 2.4,
 * `projects.edit`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addCustomFieldOption } from '@/app-layer/usecases/custom-field';
import { CustomFieldOptionInputSchema } from '@/lib/schemas/custom-field';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string; fieldId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CustomFieldOptionInputSchema);
        return jsonResponse(await addCustomFieldOption(ctx, params.projectId, params.fieldId, input), { status: 201 });
    }),
);
