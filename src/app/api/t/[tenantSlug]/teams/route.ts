/**
 * Teams: list and create (a new team is seeded with its workflow).
 *
 * Keys: reads take `projects.view`; changes take `admin.manage` (teams,
 * workflows, types and labels are workspace settings until the owner decides
 * otherwise; see src/app-layer/policies/work-config.policies.ts).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { createTeam, listTeams } from '@/app-layer/usecases/team';
import { CreateTeamSchema } from '@/lib/schemas/work-config';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listTeams(ctx));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, CreateTeamSchema);
        return jsonResponse(await createTeam(ctx, input), { status: 201 });
    }),
);
