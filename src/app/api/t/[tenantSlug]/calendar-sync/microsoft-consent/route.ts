/**
 * "Authorise Microsoft 365" and "Withdraw" (roadmap 3.3b; ADR 0011 §6; owner
 * decision 237), under `integrations.manage`. POST answers the admin-consent
 * URL as JSON and sets the sealed state cookie the callback
 * (`/api/integrations/calendar/admin-callback`) checks; DELETE withdraws the
 * consent and tears down every Microsoft connection. Closed by
 * `CALENDAR_SYNC`, a 404.
 *
 * Adapted from inflect-compliance `src/app/api/t/[tenantSlug]/admin/calendar/consent/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1): `integrations.manage`
 * instead of `admin.manage`, a sealed state bound to the admin.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { startMicrosoftConsent, withdrawMicrosoftConsent } from '@/app-layer/usecases/calendar-sync-settings';
import { stateCookieOptions, whenCalendarSyncOpen } from '@/lib/calendar-sync/http';

export const POST = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('integrations.manage', async (_req: NextRequest, _route, ctx) => {
            const { consentUrl, stateCookie } = await startMicrosoftConsent(ctx);
            const res = jsonResponse({ consentUrl });
            res.cookies.set(stateCookie.name, stateCookie.value, stateCookieOptions());
            return res;
        }),
    ),
);

export const DELETE = withApiErrorHandling(
    whenCalendarSyncOpen(
        requirePermission<{ tenantSlug: string }>('integrations.manage', async (_req: NextRequest, _route, ctx) => {
            return jsonResponse(await withdrawMicrosoftConsent(ctx));
        }),
    ),
);
