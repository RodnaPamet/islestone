/**
 * Bulk writes on my notifications (sub-phase 2.7c): `{ action: 'mark-all-read' }`
 * marks every unread row still in the Inbox read; `{ action: 'update', ids,
 * read?, done? }` changes up to 200 named rows. Rows that are not the
 * caller's are left alone. No permission key: every member manages their own.
 *
 * Written fresh for Islestone.
 */
import { getTenantCtx } from '@/app-layer/context';
import { bulkUpdateMyNotifications } from '@/app-layer/usecases/notification';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { NotificationBulkSchema } from '@/lib/schemas/notifications';
import { withValidatedBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(withValidatedBody(NotificationBulkSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await bulkUpdateMyNotifications(ctx, body));
}));
