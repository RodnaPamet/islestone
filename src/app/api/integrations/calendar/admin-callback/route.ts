/**
 * Where Microsoft returns after a customer directory's admin authorises
 * calendar access (roadmap 3.3b; ADR 0011 §6; owner decision 237). The answer
 * carries NO code: `admin_consent=True&tenant=<directory id>` on success,
 * `error` when the admin declined or may not consent.
 *
 * Nothing is stored unless the sealed state verifies, matches the returned
 * `state`, has never been used and names the session's user; then
 * `requirePermission('integrations.manage')` for the state's workspace (the
 * admin must still hold it; inflect's callback asked nothing at this point)
 * and the directory id is recorded with who granted it.
 *
 * Adapted from inflect-compliance `src/app/api/integrations/calendar/admin-callback/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { recordMicrosoftConsent } from '@/app-layer/usecases/calendar-sync-settings';
import { providerErrorCode, redirectBack } from '@/lib/calendar-sync/callback';
import { ADMIN_STATE_COOKIE, claimStateNonce, stateMatches, unsealCalendarState } from '@/lib/calendar-sync/oauth-state';
import { isCalendarSyncOpen } from '@/lib/calendar-sync/switch';
import { withApiErrorHandling } from '@/lib/errors/api';
import { isAppError } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { requirePermission } from '@/lib/security/permission-middleware';

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    if (!isCalendarSyncOpen()) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404 });
    const sealed = unsealCalendarState(req.cookies.get(ADMIN_STATE_COOKIE)?.value, 'admin-consent');
    const settings = sealed ? `/t/${sealed.tenantSlug}/settings/calendar-sync` : '/';
    if (!sealed || !stateMatches(req.nextUrl.searchParams.get('state'), sealed)) {
        logger.warn('calendar admin-consent callback refused: state missing or mismatched', { component: 'calendar-sync', hasCookie: req.cookies.has(ADMIN_STATE_COOKIE) });
        return redirectBack(req, ADMIN_STATE_COOKIE, settings, 'consent_failed');
    }

    const handler = requirePermission<{ tenantSlug: string }>('integrations.manage', async (request, _route, ctx) => {
        if (ctx.userId !== sealed.userId || !(await claimStateNonce(sealed.nonce))) {
            logger.warn('calendar admin-consent callback refused: another person, or a used state', { component: 'calendar-sync', tenantId: ctx.tenantId });
            return redirectBack(request, ADMIN_STATE_COOKIE, settings, 'consent_failed');
        }
        const errorCode = providerErrorCode(request.nextUrl.searchParams.get('error'));
        const granted = (request.nextUrl.searchParams.get('admin_consent') ?? '').toLowerCase() === 'true';
        if (errorCode || !granted) {
            logger.info('Microsoft admin consent not granted', { component: 'calendar-sync', tenantId: ctx.tenantId, errorCode });
            return redirectBack(request, ADMIN_STATE_COOKIE, settings, errorCode ? 'consent_declined' : 'consent_failed');
        }
        try {
            await recordMicrosoftConsent(ctx, { directoryId: request.nextUrl.searchParams.get('tenant') ?? '' });
        } catch (err) {
            if (isAppError(err) && err.status === 400) return redirectBack(request, ADMIN_STATE_COOKIE, settings, 'consent_failed');
            throw err;
        }
        return redirectBack(request, ADMIN_STATE_COOKIE, settings, 'consent_granted');
    });
    try {
        return await handler(req, { params: Promise.resolve({ tenantSlug: sealed.tenantSlug }) });
    } catch (err) {
        if (isAppError(err) && (err.status === 401 || err.status === 403 || err.status === 404)) return redirectBack(req, ADMIN_STATE_COOKIE, '/', 'consent_failed');
        throw err;
    }
});
