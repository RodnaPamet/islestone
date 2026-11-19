/**
 * Labels: list (`?teamId=` adds that team's labels to the workspace ones) and create.
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings until the owner decides
 * otherwise; see src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createLabel, listLabels } from '@/app-layer/usecases/label';
import { CreateLabelSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (req: NextRequest, _args, ctx) => {
        const teamId = req.nextUrl.searchParams.get('teamId') ?? undefined;
        return jsonResponse(await listLabels(ctx, { teamId }));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateLabelSchema);
        return jsonResponse(await createLabel(ctx, input), { status: 201 });
    }),
);
