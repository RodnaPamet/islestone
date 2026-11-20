/**
 * One project template (sub-phase 2.5c): rename, archive or unarchive it
 * (`PATCH`), and delete it. Key: `admin.manage` (owner decision 71). Its
 * content is not edited here: save a project again.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteProjectTemplate, updateProjectTemplate } from '@/app-layer/usecases/project-template';
import { UpdateProjectTemplateSchema } from '@/lib/schemas/template';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; templateId: string };

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('admin.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateProjectTemplateSchema);
        return jsonResponse(await updateProjectTemplate(ctx, params.templateId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<Params>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteProjectTemplate(ctx, params.templateId));
    }),
);
