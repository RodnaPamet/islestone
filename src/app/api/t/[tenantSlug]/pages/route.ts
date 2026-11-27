/**
 * Pages (sub-phase 4.1a; owner decisions 339 and 341). GET reads one tree's
 * children (`?scope=workspace` or `?projectId=`, and `parentId`, `after`)
 * under `pages.view`; POST creates a page in a tree under `pages.create`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createPage, listPageChildren } from '@/app-layer/usecases/page';
import { CreatePageSchema, PageTreeQuerySchema } from '@/lib/schemas/page';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('pages.view', async (req: NextRequest, _args, ctx) => {
        const q = PageTreeQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listPageChildren(ctx, q));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('pages.create', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreatePageSchema);
        return jsonResponse(await createPage(ctx, input), { status: 201 });
    }),
);
