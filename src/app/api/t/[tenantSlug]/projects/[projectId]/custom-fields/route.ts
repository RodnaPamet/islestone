/**
 * A project's custom fields (sub-phase 2.4): list (`projects.view`) and
 * create (`projects.edit`, the key that changes a project).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createCustomField, listCustomFields } from '@/app-layer/usecases/custom-field';
import { CreateCustomFieldSchema, ListCustomFieldsQuerySchema } from '@/lib/schemas/custom-field';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.view', async (req: NextRequest, { params }, ctx) => {
        const query = ListCustomFieldsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const includeArchived = query.includeArchived === 'true' || query.includeArchived === '1';
        return jsonResponse(await listCustomFields(ctx, params.projectId, { includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CreateCustomFieldSchema);
        return jsonResponse(await createCustomField(ctx, params.projectId, input), { status: 201 });
    }),
);
