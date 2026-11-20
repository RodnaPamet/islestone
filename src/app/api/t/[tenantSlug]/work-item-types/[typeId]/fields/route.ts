/**
 * A work item type's built-in field rules (sub-phase 2.4b-b; ADR 0002 §1;
 * owner decisions 108 to 112): every configurable field with its
 * requirement. Keys: reads take `projects.view`; a change takes
 * `admin.manage`, as the type itself (decision 112).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listTypeFields, setTypeField } from '@/app-layer/usecases/field-set';
import { SetTypeFieldSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; typeId: string }>('projects.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await listTypeFields(ctx, params.typeId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; typeId: string }>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetTypeFieldSchema);
        return jsonResponse(await setTypeField(ctx, params.typeId, input));
    }),
);
