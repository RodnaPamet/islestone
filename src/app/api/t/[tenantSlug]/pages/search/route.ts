/**
 * Pages by title (sub-phase 4.1a; decision 347's titles): `?q=`, and
 * optionally one tree (`?scope=workspace` or `?projectId=`). The move
 * dialog's parent search reads it. Key: `pages.view`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { searchPageTitles, treeRefOf } from '@/app-layer/usecases/page';
import { PageSearchQuerySchema } from '@/lib/schemas/page';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('pages.view', async (req: NextRequest, _args, ctx) => {
        const q = PageSearchQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const tree = q.scope === 'workspace' || q.projectId ? treeRefOf(q) : undefined;
        return jsonResponse(await searchPageTitles(ctx, q.q, tree));
    }),
);
