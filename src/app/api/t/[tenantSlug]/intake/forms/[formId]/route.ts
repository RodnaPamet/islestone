/**
 * One intake form (sub-phase 2.6a): read it (`intake.view`); rename,
 * redefine, publish, unpublish, archive or restore it (`intake.manage`;
 * `If-Match` required for a name or definition change).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getIntakeForm, updateIntakeForm } from '@/app-layer/usecases/intake-form';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { UpdateIntakeFormSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; formId: string }>('intake.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getIntakeForm(ctx, params.formId));
    }),
);

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; formId: string }>('intake.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateIntakeFormSchema);
        return jsonResponse(await updateIntakeForm(ctx, params.formId, input, expectedVersionFrom(req)));
    }),
);
