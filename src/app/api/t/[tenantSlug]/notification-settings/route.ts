/**
 * The workspace's notification settings — the sender identity, BCC mailbox
 * and email switch every workspace email reads, and the in-app mute list.
 *
 * Gated `admin.manage` at the route, so a refusal writes an AUTHZ_DENIED row;
 * the path sits outside `/api/t/:slug/admin/`, so the edge admin gate never
 * applies. The usecase's `assertCanAdmin` stays behind it: the two together
 * admit exactly the OWNER and ADMIN memberships.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notification-settings/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e; the policy check and data
 * access moved into `@/app-layer/usecases/notification-settings`.
 */
import type { NextRequest } from 'next/server';

import {
    getNotificationSettingsView,
    updateNotificationSettings,
} from '@/app-layer/usecases/notification-settings';
import { UpdateNotificationSettingsSchema } from '@/app-layer/schemas/notification-settings.schemas';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';

/** GET — the settings, the outbox stats and the in-app type catalogue. */
export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        return jsonResponse(await getNotificationSettingsView(ctx));
    }),
);

/** PUT — a partial update of the settings. */
export const PUT = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const input = UpdateNotificationSettingsSchema.parse(await req.json());
        return jsonResponse(await updateNotificationSettings(ctx, input));
    }),
);
