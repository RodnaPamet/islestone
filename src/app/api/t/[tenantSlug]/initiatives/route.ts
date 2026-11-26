/**
 * Initiatives (sub-phase 3.2a; owner decision 213). GET lists them
 * (`?status=&archived=&deleted=&leadUserId=&health=&goalId=`) under
 * `goals.view`; POST creates one under `goals.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createInitiative, listInitiatives } from '@/app-layer/usecases/initiative';
import { CreateInitiativeSchema, GoalListQuerySchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('goals.view', async (req: NextRequest, _args, ctx) => {
        const q = GoalListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listInitiatives(ctx, q));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('goals.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateInitiativeSchema);
        return jsonResponse(await createInitiative(ctx, input), { status: 201 });
    }),
);
