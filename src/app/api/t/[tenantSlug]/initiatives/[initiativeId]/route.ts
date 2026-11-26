/**
 * One initiative (sub-phase 3.2a): read it with its goal and projects
 * (`goals.view`); change it (`goals.manage`; `If-Match` required for a name or
 * description change); delete it softly (`goals.manage`, decision 218).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteInitiative, getInitiative, updateInitiative } from '@/app-layer/usecases/initiative';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { UpdateInitiativeSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; initiativeId: string }>('goals.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getInitiative(ctx, params.initiativeId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; initiativeId: string }>('goals.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateInitiativeSchema);
        return jsonResponse(await updateInitiative(ctx, params.initiativeId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; initiativeId: string }>('goals.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await deleteInitiative(ctx, params.initiativeId));
    }),
);
