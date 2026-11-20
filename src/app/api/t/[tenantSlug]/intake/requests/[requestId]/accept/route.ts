/**
 * Accept a request: create its work item and mark it accepted, in one transaction (also `work_items.create`, asserted by the usecase) (sub-phase 2.6a; owner decision 90). Key `intake.triage`; the
 * request's version in `If-Match` (required), 409 when it moved on.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { acceptIntakeRequest } from '@/app-layer/usecases/intake-request';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { AcceptIntakeRequestSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; requestId: string }>('intake.triage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AcceptIntakeRequestSchema);
        return jsonResponse(await acceptIntakeRequest(ctx, params.requestId, input, expectedVersionFrom(req)));
    }),
);
