/**
 * Work items: the live list (cursor-paginated) and create.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/tasks/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: cursor-only (the uncapped branch is
 * gone; H2 seeds 100,000 items), the facets are stateCategory / priority /
 * typeId / assigneeId / labelId (parsed by `WorkItemRepository._buildWhere`),
 * and the Deleted view is its own route (`/work-items/deleted`, its own key).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createWorkItem, listWorkItems } from '@/app-layer/usecases/work-item';
import { CreateWorkItemSchema, WorkItemQuerySchema } from '@/lib/schemas/work-item';
import { normalizeQ } from '@/lib/filters/query-helpers';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _args, ctx) => {
        const query = WorkItemQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        const result = await listWorkItems(ctx, {
            ...query,
            q: normalizeQ(query.q),
            includeArchived: query.includeArchived === 'true' || query.includeArchived === '1',
        });
        return jsonResponse(result);
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.create', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateWorkItemSchema);
        return jsonResponse(await createWorkItem(ctx, input), { status: 201 });
    }),
);
