/**
 * Reopen a snoozed, declined or merged request (sub-phase 2.6a; owner decision 90). Key `intake.triage`; the
 * request's version in `If-Match` (required), 409 when it moved on.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { reopenIntakeRequest } from '@/app-layer/usecases/intake-request';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; requestId: string }>('intake.triage', async (req: NextRequest, { params }, ctx) => {
        return jsonResponse(await reopenIntakeRequest(ctx, params.requestId, expectedVersionFrom(req)));
    }),
);
