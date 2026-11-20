/**
 * A project's item templates (sub-phase 2.5c): list (`projects.view`) and
 * create (`projects.edit`; owner decisions 71 and 72).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createWorkItemTemplate, listWorkItemTemplates } from '@/app-layer/usecases/work-item-template';
import { ListCustomFieldsQuerySchema } from '@/lib/schemas/custom-field';
import { CreateWorkItemTemplateSchema } from '@/lib/schemas/template';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.view', async (req: NextRequest, { params }, ctx) => {
        const query = ListCustomFieldsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const includeArchived = query.includeArchived === 'true' || query.includeArchived === '1';
        return jsonResponse(await listWorkItemTemplates(ctx, params.projectId, { includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, CreateWorkItemTemplateSchema);
        return jsonResponse(await createWorkItemTemplate(ctx, params.projectId, input), { status: 201 });
    }),
);
