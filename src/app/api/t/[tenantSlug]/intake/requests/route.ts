/**
 * Intake requests (sub-phase 2.6a): one page of a view (new, snoozed, spam,
 * decided), workspace-wide or one project's. Key `intake.view` (decision 92).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listIntakeRequests } from '@/app-layer/usecases/intake-request';
import { IntakeListQuerySchema } from '@/lib/schemas/intake';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.view', async (req: NextRequest, _args, ctx) => {
        const query = IntakeListQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await listIntakeRequests(ctx, query));
    }),
);
