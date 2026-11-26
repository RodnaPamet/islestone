/**
 * Where Google and Microsoft return after a member connects their calendar
 * (roadmap 3.3b; docs/porting/maps/3.3.md, "Connecting a calendar", step 4;
 * ADR 0011 §6). Outside `/t/` because each provider redirects to one fixed
 * URI (distinct from NextAuth's `/api/auth/callback/<provider>`); a signed-in
 * path, not public and not a machine caller.
 *
 * Nothing is stored unless the sealed state cookie verifies, its nonce is the
 * returned `state` and has never been used, and the state's user is the
 * session's: a state minted for another person or workspace is refused. Then
 * `requirePermission('work_items.view')` for the state's workspace (an
 * audited 403 otherwise), the provider's `error` (its code only), and the
 * usecase: the switch and the consent asked again, the code exchanged with
 * the PKCE verifier, the dedicated calendar, the connection.
 *
 * Adapted from inflect-compliance `src/app/api/integrations/calendar/callback/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1): a sealed state bound
 * to the member, PKCE, the user check, single use.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { completeCalendarConnect } from '@/app-layer/usecases/calendar-connection';
import { providerErrorCode, redirectBack } from '@/lib/calendar-sync/callback';
import { CONNECT_STATE_COOKIE, claimStateNonce, stateMatches, unsealOAuthState } from '@/lib/calendar-sync/oauth-state';
import { isCalendarSyncOpen } from '@/lib/calendar-sync/switch';
import { withApiErrorHandling } from '@/lib/errors/api';
import { isAppError } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { requirePermission } from '@/lib/security/permission-middleware';

const REFUSAL_OUTCOME: Record<string, 'sync_off' | 'not_authorised' | 'refused'> = {
    CALENDAR_SYNC_OFF: 'sync_off',
    MICROSOFT_NOT_AUTHORISED: 'not_authorised',
};

export const GET = withApiErrorHandling(async (req: NextRequest) => {
    if (!isCalendarSyncOpen()) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not Found' } }, { status: 404 });
    const sealed = unsealOAuthState(req.cookies.get(CONNECT_STATE_COOKIE)?.value, 'connect');
    const preferences = sealed ? `/t/${sealed.tenantSlug}/inbox/preferences` : '/';
    if (!sealed || !stateMatches(req.nextUrl.searchParams.get('state'), sealed)) {
        logger.warn('calendar callback refused: state missing or mismatched', { component: 'calendar-sync', hasCookie: req.cookies.has(CONNECT_STATE_COOKIE) });
        return redirectBack(req, CONNECT_STATE_COOKIE, preferences, 'failed');
    }

    const handler = requirePermission<{ tenantSlug: string }>('work_items.view', async (request, _route, ctx) => {
        if (ctx.userId !== sealed.userId) {
            // Minted for somebody else: nothing is stored.
            logger.warn('calendar callback refused: the state belongs to another person', { component: 'calendar-sync', tenantId: ctx.tenantId });
            return redirectBack(request, CONNECT_STATE_COOKIE, preferences, 'failed');
        }
        if (!(await claimStateNonce(sealed.nonce))) {
            logger.warn('calendar callback refused: the state was used before or cannot be proved unused', { component: 'calendar-sync', tenantId: ctx.tenantId });
            return redirectBack(request, CONNECT_STATE_COOKIE, preferences, 'failed');
        }
        const errorCode = providerErrorCode(request.nextUrl.searchParams.get('error'));
        if (errorCode) {
            logger.info('calendar consent declined at the provider', { component: 'calendar-sync', tenantId: ctx.tenantId, provider: sealed.provider, errorCode });
            return redirectBack(request, CONNECT_STATE_COOKIE, preferences, 'declined');
        }
        const code = request.nextUrl.searchParams.get('code');
        if (!code || code.length > 4096) return redirectBack(request, CONNECT_STATE_COOKIE, preferences, 'failed');
        try {
            const outcome = await completeCalendarConnect(ctx, { provider: sealed.provider, code, codeVerifier: sealed.verifier! });
            return redirectBack(request, CONNECT_STATE_COOKIE, preferences, outcome);
        } catch (err) {
            const reason = isAppError(err) ? (err.details as { reason?: string } | undefined)?.reason : undefined;
            if (reason && REFUSAL_OUTCOME[reason]) return redirectBack(request, CONNECT_STATE_COOKIE, preferences, REFUSAL_OUTCOME[reason]);
            logger.warn('calendar connection failed after the provider returned', { component: 'calendar-sync', tenantId: ctx.tenantId, provider: sealed.provider, status: (err as { status?: unknown })?.status ?? null });
            return redirectBack(request, CONNECT_STATE_COOKIE, preferences, 'failed');
        }
    });
    try {
        return await handler(req, { params: Promise.resolve({ tenantSlug: sealed.tenantSlug }) });
    } catch (err) {
        // A refusal by the workspace's gates (audited by requirePermission when it is the key).
        if (isAppError(err) && (err.status === 401 || err.status === 403 || err.status === 404)) return redirectBack(req, CONNECT_STATE_COOKIE, '/', 'failed');
        throw err;
    }
});
