/**
 * One tree's Deleted list: each deleted group's root, newest first
 * (`?scope=workspace` or `?projectId=`; sub-phase 4.1a, decision 344). Key:
 * `pages.delete`, the key that restores.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listDeletedPages, treeRefOf } from '@/app-layer/usecases/page';
import { DeletedPagesQuerySchema } from '@/lib/schemas/page';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('pages.delete', async (req: NextRequest, _args, ctx) => {
        const q = DeletedPagesQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listDeletedPages(ctx, treeRefOf(q)));
    }),
);
