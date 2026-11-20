/**
 * One item template (sub-phase 2.5c): change, archive, unarchive or reorder
 * it (`PATCH`), and delete it. Key: `projects.edit`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteWorkItemTemplate, updateWorkItemTemplate } from '@/app-layer/usecases/work-item-template';
import { UpdateWorkItemTemplateSchema } from '@/lib/schemas/template';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; projectId: string; templateId: string };

export const PATCH = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateWorkItemTemplateSchema);
        return jsonResponse(await updateWorkItemTemplate(ctx, params.projectId, params.templateId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<Params>('projects.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteWorkItemTemplate(ctx, params.projectId, params.templateId));
    }),
);
