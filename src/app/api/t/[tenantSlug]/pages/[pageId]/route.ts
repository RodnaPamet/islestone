/**
 * One page (sub-phase 4.1a): read it with its tree, ancestors and subpages
 * (`pages.view`); rename it (`pages.edit`; `If-Match` required, decision
 * 343); delete it softly with its subtree (`pages.delete`, decision 344).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deletePage, getPage, renamePage } from '@/app-layer/usecases/page';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { RenamePageSchema } from '@/lib/schemas/page';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; pageId: string }>('pages.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getPage(ctx, params.pageId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; pageId: string }>('pages.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, RenamePageSchema);
        return jsonResponse(await renamePage(ctx, params.pageId, input.title, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; pageId: string }>('pages.delete', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deletePage(ctx, params.pageId));
    }),
);
