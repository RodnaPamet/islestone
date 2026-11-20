/**
 * Saved views (sub-phase 2.4): the views the caller can see (`views.view`),
 * and save one (`views.create`; a shared one also needs `views.share`, asked
 * by the usecase). `?projectId=` lists one project's, `?scope=workspace` the
 * Work items page's, and no parameter every scope (the Views page).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createSavedView, listSavedViews } from '@/app-layer/usecases/saved-view';
import { CreateSavedViewSchema, ListSavedViewsQuerySchema } from '@/lib/schemas/saved-view';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('views.view', async (req: NextRequest, _args, ctx) => {
        const query = ListSavedViewsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const scope = query.projectId ?? (query.scope === 'workspace' ? null : undefined);
        return jsonResponse(await listSavedViews(ctx, scope));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('views.create', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateSavedViewSchema);
        return jsonResponse(await createSavedView(ctx, input), { status: 201 });
    }),
);
