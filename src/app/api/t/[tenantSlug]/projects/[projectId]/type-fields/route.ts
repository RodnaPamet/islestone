/**
 * A project's custom-field rules per work item type (sub-phase 2.4b-b; ADR
 * 0002 §7; owner decisions 108 and 112). Keys: reads take `projects.view`; a
 * change takes `projects.edit`, as the field's definition (decision 112).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listProjectTypeFields, setProjectTypeField } from '@/app-layer/usecases/field-set';
import { SetProjectTypeFieldSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listProjectTypeFields(ctx, params.projectId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetProjectTypeFieldSchema);
        return jsonResponse(await setProjectTypeField(ctx, params.projectId, input));
    }),
);
