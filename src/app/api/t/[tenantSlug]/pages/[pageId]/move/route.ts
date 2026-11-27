/**
 * Move a page with its subtree: to a new parent and a place, in its own tree
 * or another (sub-phase 4.1a, decision 341). Key: `pages.edit`; `If-Match`
 * optional.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { movePage } from '@/app-layer/usecases/page';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { MovePageSchema } from '@/lib/schemas/page';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; pageId: string }>('pages.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, MovePageSchema);
        return jsonResponse(await movePage(ctx, params.pageId, input, expectedVersionFrom(req)));
    }),
);
