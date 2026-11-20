/**
 * One saved view (sub-phase 2.4): read (`views.view`), change and delete
 * (`views.edit`; the usecase admits the creator only, and a workspace admin
 * deleting a shared view for moderation).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteSavedView, getSavedView, updateSavedView } from '@/app-layer/usecases/saved-view';
import { UpdateSavedViewSchema } from '@/lib/schemas/saved-view';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; viewId: string }>('views.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getSavedView(ctx, params.viewId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; viewId: string }>('views.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateSavedViewSchema);
        return jsonResponse(await updateSavedView(ctx, params.viewId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; viewId: string }>('views.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteSavedView(ctx, params.viewId));
    }),
);
