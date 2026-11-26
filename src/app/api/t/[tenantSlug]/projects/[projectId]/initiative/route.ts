/**
 * Name a project's initiative, or clear it (sub-phase 3.2a): a project field
 * under `projects.edit`; naming one also asks `goals.view` in the usecase.
 * A versioned project write: `If-Match` optional.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setProjectInitiative } from '@/app-layer/usecases/initiative';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetProjectInitiativeSchema } from '@/lib/schemas/goal';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('projects.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetProjectInitiativeSchema);
        return jsonResponse(await setProjectInitiative(ctx, params.projectId, input, expectedVersionFrom(req)));
    }),
);
