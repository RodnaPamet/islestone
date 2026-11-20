/** The forms a member may send a request through now (sub-phase 2.6a). Key `projects.view`. */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listOpenIntakeForms } from '@/app-layer/usecases/intake-form';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listOpenIntakeForms(ctx));
    }),
);
