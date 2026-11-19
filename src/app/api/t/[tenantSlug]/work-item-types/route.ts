/**
 * Work item types: list (`?includeArchived=1`) and create.
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings; owner decision
 * 2026-11-19, src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createWorkItemType, listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { CreateWorkItemTypeSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (req: NextRequest, _args, ctx) => {
        const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
        return jsonResponse(await listWorkItemTypes(ctx, { includeArchived }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateWorkItemTypeSchema);
        return jsonResponse(await createWorkItemType(ctx, input), { status: 201 });
    }),
);
