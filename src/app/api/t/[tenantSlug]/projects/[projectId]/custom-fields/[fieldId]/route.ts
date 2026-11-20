/**
 * One custom field (sub-phase 2.4): rename, reorder, archive and unarchive
 * (`projects.edit`). A field is never deleted: archived, it keeps its values.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { updateCustomField } from '@/app-layer/usecases/custom-field';
import { UpdateCustomFieldSchema } from '@/lib/schemas/custom-field';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string; fieldId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateCustomFieldSchema);
        return jsonResponse(await updateCustomField(ctx, params.projectId, params.fieldId, input));
    }),
);
