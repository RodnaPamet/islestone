/**
 * One intake request (sub-phase 2.6a): read it (`intake.view`), or change a
 * new or snoozed request's title or text (`intake.triage`, `If-Match`
 * required).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { editIntakeRequest, getIntakeRequest } from '@/app-layer/usecases/intake-request';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { EditIntakeRequestSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; requestId: string }>('intake.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getIntakeRequest(ctx, params.requestId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; requestId: string }>('intake.triage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, EditIntakeRequestSchema);
        return jsonResponse(await editIntakeRequest(ctx, params.requestId, input, expectedVersionFrom(req)));
    }),
);
