/**
 * My notification preferences in this workspace (sub-phase 2.7c; owner
 * decision 132). `GET`: one row per notification type, my choice (or the
 * default) and what the writers do under the workspace's ceiling. `PUT
 * { rows }`: change some types, or reset one to its default; audited.
 *
 * No permission key: a member manages their own (`assertCanRead` in the
 * usecase; every row is keyed by the caller's user id).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { getTenantCtx } from '@/app-layer/context';
import { getMyNotificationPreferences, updateMyNotificationPreferences } from '@/app-layer/usecases/notification-preferences';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { UpdatePreferencesSchema } from '@/lib/schemas/notifications';
import { withValidatedBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await getMyNotificationPreferences(ctx));
});

export const PUT = withApiErrorHandling(withValidatedBody(UpdatePreferencesSchema, async (req, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }, body) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    return jsonResponse(await updateMyNotificationPreferences(ctx, body));
}));
