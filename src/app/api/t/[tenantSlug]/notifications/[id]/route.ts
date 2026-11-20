/**
 * One of my notifications. `PUT` (body `{}`) marks it read: the bell's call,
 * kept. `PATCH { read?, done? }` (sub-phase 2.7c) marks it read or unread,
 * Done or back in the Inbox (owner decision 134); marking Done also marks it
 * read. A row that is not the caller's is a silent no-op.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notifications/[id]/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the empty-body schema is
 * inline (inflect imports it from a compliance schema module).
 */
import { z } from 'zod';

import { getTenantCtx } from '@/app-layer/context';
import { markNotificationRead, updateMyNotification } from '@/app-layer/usecases/notification';
import { withValidatedBody } from '@/lib/validation/route';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { NotificationChangeSchema } from '@/lib/schemas/notifications';

/** The request carries no fields; `withValidatedBody` still requires JSON (`{}`). */
const EmptyBodySchema = z.object({}).strict();

export const PUT = withApiErrorHandling(withValidatedBody(EmptyBodySchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const result = await markNotificationRead(ctx, params.id);
    return jsonResponse(result);
}));

export const PATCH = withApiErrorHandling(withValidatedBody(NotificationChangeSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string; id: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await updateMyNotification(ctx, params.id, body));
}));
