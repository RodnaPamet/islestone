/**
 * The workspace's project templates (sub-phase 2.5c): list them
 * (`projects.create`, the key that uses one; never their content), and save
 * a project as one (`admin.manage`; owner decision 71).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listProjectTemplates, saveProjectAsTemplate } from '@/app-layer/usecases/project-template';
import { ListCustomFieldsQuerySchema } from '@/lib/schemas/custom-field';
import { SaveProjectAsTemplateSchema } from '@/lib/schemas/template';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.create', async (req: NextRequest, _route, ctx) => {
        const query = ListCustomFieldsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const includeArchived = query.includeArchived === 'true' || query.includeArchived === '1';
        return jsonResponse(await listProjectTemplates(ctx, { includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _route, ctx) => {
        const input = await parseJsonBody(req, SaveProjectAsTemplateSchema);
        return jsonResponse(await saveProjectAsTemplate(ctx, input), { status: 201 });
    }),
);
