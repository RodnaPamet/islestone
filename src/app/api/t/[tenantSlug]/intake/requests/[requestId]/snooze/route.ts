/**
 * Snooze a request until a date (sub-phase 2.6a; owner decision 90). Key `intake.triage`; the
 * request's version in `If-Match` (required), 409 when it moved on.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { snoozeIntakeRequest } from '@/app-layer/usecases/intake-request';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SnoozeIntakeRequestSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; requestId: string }>('intake.triage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SnoozeIntakeRequestSchema);
        return jsonResponse(await snoozeIntakeRequest(ctx, params.requestId, input, expectedVersionFrom(req)));
    }),
);
