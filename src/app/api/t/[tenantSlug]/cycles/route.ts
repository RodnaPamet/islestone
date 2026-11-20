/**
 * Cycles (sub-phase 2.5a): every team's cycles with their counts, and a
 * one-off cycle. Keys: `cycles.view` reads, `cycles.manage` creates (owner
 * decision 72; src/app-layer/policies/cycle.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createCycle, listCycles } from '@/app-layer/usecases/cycle';
import { CreateCycleSchema, CycleQuerySchema } from '@/lib/schemas/cycle';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('cycles.view', async (req: NextRequest, _args, ctx) => {
        const query = CycleQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listCycles(ctx, query));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('cycles.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateCycleSchema);
        return jsonResponse(await createCycle(ctx, input), { status: 201 });
    }),
);
