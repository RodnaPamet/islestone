/**
 * Whether new time entries on a project are billable by default (sub-phase
 * 3.4d; owner decision 271): `time.rates`; `If-Match` optional (the project's
 * version). Audited `PROJECT_UPDATED` naming `timeBillableByDefault`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { setProjectBillableDefault } from '@/app-layer/usecases/billable-rate';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { ProjectBillableDefaultSchema } from '@/lib/schemas/billable-rate';
import { parseJsonBody } from '@/lib/validation/route';

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; projectId: string }>('time.rates', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, ProjectBillableDefaultSchema);
        return jsonResponse(await setProjectBillableDefault(ctx, params.projectId, input, expectedVersionFrom(req)));
    }),
);
