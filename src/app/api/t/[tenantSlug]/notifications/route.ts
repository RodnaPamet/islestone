/**
 * List my notifications in this workspace (the bell, the Inbox in 2.7).
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notifications/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (`import type`).
 */
import type { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listMyNotifications } from '@/app-layer/usecases/notification';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const notifications = await listMyNotifications(ctx);
    return jsonResponse(notifications);
});
