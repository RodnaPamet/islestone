/**
 * Mark one of my notifications read (`PUT`, body `{}`).
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notifications/[id]/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the empty-body schema is
 * inline (inflect imports it from a compliance schema module).
 */
import { z } from 'zod';

import { getTenantCtx } from '@/app-layer/context';
import { markNotificationRead } from '@/app-layer/usecases/notification';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

/** The request carries no fields; `withValidatedBody` still requires JSON (`{}`). */
const EmptyBodySchema = z.object({}).strict();

export const PUT = withApiErrorHandling(withValidatedBody(EmptyBodySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await markNotificationRead(ctx, params.id);
    return jsonResponse(result);
}));
