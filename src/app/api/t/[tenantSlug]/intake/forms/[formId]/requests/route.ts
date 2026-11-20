/**
 * Send a request through an internal form (sub-phase 2.6a): anyone who sees
 * the form's project (`projects.view`). A form that is not open now is a
 * 404. The body is validated by the form's own compiled schema in the usecase.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { badRequest } from '@/lib/errors/types';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; formId: string }>('projects.view', async (req: NextRequest, { params }, ctx) => {
        const body: unknown = await req.json().catch(() => {
            throw badRequest('The request body must be JSON.');
        });
        return jsonResponse(await sendIntakeRequest(ctx, params.formId, body), { status: 201 });
    }),
);
