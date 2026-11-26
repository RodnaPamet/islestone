/**
 * A member's own calendar connection (roadmap 3.3b; ADR 0011 §5 to §8;
 * docs/porting/maps/3.3.md, "Connecting a calendar" and "Disconnecting and
 * teardown"; owner decisions 234 to 239).
 *
 * Everything is keyed off `ctx.userId`, never a user id in the request
 * (decision 235). Connecting takes `work_items.view` (Viewers included, as a
 * read-only feed), the workspace's switch (decision 234), the provider's
 * sign-in app (decision 236) and, for Microsoft, the directory's admin consent
 * (decision 237). The OAuth round trip is hand-written here and in
 * `token.ts`, outside the auth library's seam (ADR 0004 A3): PKCE, a sealed
 * single-use state bound to the member and the workspace, the calendar scope
 * alone; it writes no `Account`, links no identity, redeems no invite and
 * reads no address.
 *
 * Adapted from inflect-compliance `src/app-layer/usecases/user-calendar-connection.ts`
 * and its connect and callback routes at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (BUSL-1.1): the token in the manifest column under the workspace's key
 * (decision 238), the dedicated "Islestone" calendar created at connect
 * (decision 228), a disconnect that removes the events before the token
 * (decision 239), and every write audited (inflect audited none of these).
 */
import type { CalendarProvider } from '@prisma/client';

import { logEvent } from '../events/audit';
import { IntegrationAuthError } from '../integrations/http-errors';
import { MissingRefreshTokenError, buildCalendarAuthorizeUrl, exchangeCalendarCode } from '../integrations/providers/calendar/token';
import { googleWriter, graphWriter } from '../integrations/providers/calendar/writer';
import { assertMayConnectCalendar, calendarFeedIsReadOnly } from '../policies/calendar-sync.policies';
import { assertActingAsPerson } from '../policies/person-only.policies';
import { visibleProjects } from '../policies/project-visibility';
import { CalendarSyncRepository } from '../repositories/CalendarSyncRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { enqueueConnectionSync, enqueueTeardowns } from './calendar-sync-enqueue';
import { syncWindow } from './calendar-sync-run';
import { CONNECT_CALLBACK_PATH, absoluteCallback, microsoftConsentGranted } from './calendar-sync-settings';
import { CONNECT_STATE_COOKIE, newConnectNonces, sealCalendarState } from '@/lib/calendar-sync/oauth-state';
import { isProviderConfigured } from '@/lib/calendar-sync/switch';
import { CALENDAR_PROVIDERS, CALENDAR_SYNC_ITEM_LIMIT, type CalendarConnectionAction, type MyCalendarSyncView, type ProviderUnavailableReason } from '@/lib/calendar-sync/types';
import { runInTenantContext, runInTenantReadContext } from '@/lib/db-context';
import { ConflictError, NotFoundError } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';

function unavailable(provider: CalendarProvider, syncEnabled: boolean, microsoftGranted: boolean): ProviderUnavailableReason | null {
    if (!syncEnabled) return 'SYNC_OFF';
    if (!isProviderConfigured(provider)) return 'NOT_CONFIGURED';
    if (provider === 'MICROSOFT' && !microsoftGranted) return 'MICROSOFT_NOT_AUTHORISED';
    return null;
}

const REFUSAL: Record<ProviderUnavailableReason, string> = {
    SYNC_OFF: 'Calendar sync is off for this workspace. An Owner or Admin turns it on in Settings.',
    NOT_CONFIGURED: 'This calendar provider is not available on this deployment.',
    MICROSOFT_NOT_AUTHORISED: "Your organisation's Microsoft administrator has not authorised calendar access yet. An Owner or Admin starts it in Settings.",
};
const REFUSAL_REASON: Record<ProviderUnavailableReason, string> = {
    SYNC_OFF: 'CALENDAR_SYNC_OFF',
    NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
    MICROSOFT_NOT_AUTHORISED: 'MICROSOFT_NOT_AUTHORISED',
};

/** The member's own section: what may be connected, what is, and how many items the window holds. */
export async function getMyCalendarSync(ctx: RequestContext): Promise<MyCalendarSyncView> {
    assertMayConnectCalendar(ctx);
    const v = await visibleProjects(ctx);
    return runInTenantReadContext(ctx, async (db) => {
        const [settings, connections] = await Promise.all([
            CalendarSyncRepository.settings(db, ctx),
            CalendarSyncRepository.connectionsOfUser(db, ctx, ctx.userId),
        ]);
        const syncEnabled = settings?.syncEnabled ?? false;
        const granted = microsoftConsentGranted(settings);
        const inWindow = connections.length > 0 ? await WorkItemRepository.countAssignedForCalendarSync(db, ctx, v, ctx.userId, syncWindow()) : 0;
        const removed = await CalendarSyncRepository.removedInCalendarCounts(db, ctx, connections.map((c) => c.id));
        return {
            syncEnabled,
            readOnly: calendarFeedIsReadOnly(ctx),
            providers: CALENDAR_PROVIDERS.map((provider) => {
                const reason = unavailable(provider, syncEnabled, granted);
                return { provider, offered: reason === null, unavailable: reason };
            }),
            connections: connections.map((c) => ({
                provider: c.provider,
                state: c.state,
                connectedAt: c.connectedAt.toISOString(),
                lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
                revokedReason: c.revokedReason,
                removedInCalendar: removed.get(c.id) ?? 0,
            })),
            items: { inWindow, limit: CALENDAR_SYNC_ITEM_LIMIT },
        };
    });
}

/**
 * "Connect Google Calendar" / "Connect Outlook Calendar": the provider's
 * authorize URL (PKCE, the calendar scope alone) and the sealed state. The
 * browser navigates to it: a top-level navigation, so the CSP is unchanged.
 */
export async function startCalendarConnect(
    ctx: RequestContext,
    provider: CalendarProvider,
): Promise<{ authorizeUrl: string; stateCookie: { name: string; value: string } }> {
    assertMayConnectCalendar(ctx);
    assertActingAsPerson(ctx, 'Connecting a calendar');
    const settings = await runInTenantReadContext(ctx, async (db) => {
        const [s, existing] = await Promise.all([CalendarSyncRepository.settings(db, ctx), CalendarSyncRepository.connectionOfUser(db, ctx, ctx.userId, provider)]);
        return { s, existing };
    });
    const reason = unavailable(provider, settings.s?.syncEnabled ?? false, microsoftConsentGranted(settings.s));
    if (reason) throw new ConflictError(REFUSAL[reason], { reason: REFUSAL_REASON[reason] });
    if (settings.existing?.state === 'DISCONNECTING') {
        throw new ConflictError('Your events are still being removed from this calendar. Connect again in a few minutes.', { reason: 'CALENDAR_DISCONNECTING' });
    }
    const redirectUri = absoluteCallback(CONNECT_CALLBACK_PATH);
    if (!redirectUri) throw new ConflictError('This deployment has no public address to return to.', { reason: 'NO_PUBLIC_ORIGIN' });
    if (!ctx.tenantSlug) throw new ConflictError('The workspace could not be named.', { reason: 'NO_WORKSPACE_SLUG' });
    const { nonce, verifier, challenge } = newConnectNonces();
    const authorizeUrl = buildCalendarAuthorizeUrl({
        provider,
        redirectUri,
        state: nonce,
        codeChallenge: challenge,
        microsoftDirectoryId: settings.s?.microsoftExternalTenantId ?? null,
    });
    const value = sealCalendarState({ purpose: 'connect', nonce, tenantSlug: ctx.tenantSlug, userId: ctx.userId, provider, verifier });
    return { authorizeUrl, stateCookie: { name: CONNECT_STATE_COOKIE, value } };
}

export type ConnectOutcome = 'connected' | 'no_refresh_token' | 'refused';

/**
 * The callback's work, after the route checked the sealed state, its single
 * use and that its user is the session's: the switch and the consent asked
 * again, the code exchanged with the verifier, the dedicated calendar created
 * (or the earlier one reused on a reconnect), the connection stored, the first
 * run queued.
 */
export async function completeCalendarConnect(ctx: RequestContext, input: { provider: CalendarProvider; code: string; codeVerifier: string }): Promise<ConnectOutcome> {
    assertMayConnectCalendar(ctx);
    assertActingAsPerson(ctx, 'Connecting a calendar');
    const before = await runInTenantReadContext(ctx, async (db) => {
        const [s, existing] = await Promise.all([CalendarSyncRepository.settings(db, ctx), CalendarSyncRepository.connectionOfUser(db, ctx, ctx.userId, input.provider)]);
        return { s, existing };
    });
    // Asked again: the switch or the consent may have changed in the ten minutes.
    const reason = unavailable(input.provider, before.s?.syncEnabled ?? false, microsoftConsentGranted(before.s));
    if (reason) throw new ConflictError(REFUSAL[reason], { reason: REFUSAL_REASON[reason] });
    if (before.existing?.state === 'DISCONNECTING') throw new ConflictError('Your events are still being removed from this calendar.', { reason: 'CALENDAR_DISCONNECTING' });
    const redirectUri = absoluteCallback(CONNECT_CALLBACK_PATH);
    if (!redirectUri) throw new ConflictError('This deployment has no public address to return to.', { reason: 'NO_PUBLIC_ORIGIN' });

    let exchanged;
    try {
        exchanged = await exchangeCalendarCode({
            provider: input.provider,
            code: input.code,
            codeVerifier: input.codeVerifier,
            redirectUri,
            microsoftDirectoryId: before.s?.microsoftExternalTenantId ?? null,
        });
    } catch (err) {
        if (err instanceof MissingRefreshTokenError) return 'no_refresh_token';
        if (err instanceof IntegrationAuthError) return 'refused';
        throw err;
    }

    let calendarId = before.existing?.externalCalendarId ?? null;
    if (!calendarId) {
        const writer = input.provider === 'GOOGLE' ? googleWriter(exchanged.token.accessToken) : graphWriter(exchanged.token.accessToken);
        calendarId = (await writer.createCalendar()).calendarId;
    }

    const connection = await runInTenantContext(ctx, async (db) => {
        const row = await CalendarSyncRepository.upsertConnected(db, ctx, {
            userId: ctx.userId,
            provider: input.provider,
            tokenEncrypted: JSON.stringify(exchanged.token),
            scopesGranted: exchanged.scopesGranted,
            externalCalendarId: calendarId,
        });
        await logEvent(db, ctx, {
            action: 'CALENDAR_CONNECTED',
            entityType: 'CalendarConnection',
            entityId: row.id,
            details: `Connected a ${input.provider === 'GOOGLE' ? 'Google' : 'Microsoft'} calendar`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'CalendarConnection', operation: before.existing ? 'updated' : 'created' },
            metadata: { provider: input.provider, scopeCount: exchanged.scopesGranted.length, reconnected: Boolean(before.existing) },
        });
        return row;
    });
    logger.info('calendar connected', { component: 'calendar-sync', tenantId: ctx.tenantId, provider: input.provider, scopeCount: exchanged.scopesGranted.length });
    await enqueueConnectionSync(ctx.tenantId, [connection.id]);
    return 'connected';
}

/**
 * "Disconnect" (decision 239): the member's own connection moves to
 * DISCONNECTING and the teardown deletes Islestone's events, then the empty
 * calendar, then the token (never revoked at Google, decision 236), then the
 * rows. Idempotent while it runs.
 */
export async function disconnectCalendar(ctx: RequestContext, provider: CalendarProvider): Promise<{ state: 'DISCONNECTING' }> {
    assertMayConnectCalendar(ctx);
    const connection = await runInTenantContext(ctx, async (db) => {
        const row = await CalendarSyncRepository.connectionOfUser(db, ctx, ctx.userId, provider);
        if (!row) throw new NotFoundError('No calendar is connected for this provider.');
        if (row.state !== 'DISCONNECTING') {
            await CalendarSyncRepository.markDisconnecting(db, ctx, [row.id]);
            await logEvent(db, ctx, {
                action: 'CALENDAR_DISCONNECTED',
                entityType: 'CalendarConnection',
                entityId: row.id,
                details: `Disconnected a ${provider === 'GOOGLE' ? 'Google' : 'Microsoft'} calendar`,
                detailsJson: { category: 'status_change', entityName: 'CalendarConnection', fromStatus: row.state, toStatus: 'DISCONNECTING' },
                metadata: { provider },
            });
        }
        return row;
    });
    await enqueueTeardowns(ctx.tenantId, [connection.id]);
    return { state: 'DISCONNECTING' };
}

/**
 * "Resync my calendar" and "Recreate" (3.3c; decision 232), the member's own
 * connection only.
 *
 *   - `resync` (a CONNECTED connection): the events the member deleted in the
 *     calendar are pushed again, and the read starts over (Google's cursor
 *     cleared); everything else is as the next run finds it.
 *   - `recreate` (a CALENDAR_REMOVED connection): back to CONNECTED with no
 *     calendar; the run creates a new "Islestone" calendar and pushes into it.
 *
 * Both are audited and queue a run; neither calls a provider here. A
 * connection in another state is a 409 naming it; the workspace's switch and
 * the provider are asked as at connect.
 */
export async function actOnCalendarConnection(ctx: RequestContext, provider: CalendarProvider, action: CalendarConnectionAction): Promise<{ state: 'CONNECTED'; resynced: number }> {
    assertMayConnectCalendar(ctx);
    assertActingAsPerson(ctx, action === 'resync' ? 'Resyncing a calendar' : 'Recreating a calendar');
    const result = await runInTenantContext(ctx, async (db) => {
        const [settings, row] = await Promise.all([CalendarSyncRepository.settings(db, ctx), CalendarSyncRepository.connectionOfUser(db, ctx, ctx.userId, provider)]);
        if (!row) throw new NotFoundError('No calendar is connected for this provider.');
        const reason = unavailable(provider, settings?.syncEnabled ?? false, microsoftConsentGranted(settings));
        if (reason) throw new ConflictError(REFUSAL[reason], { reason: REFUSAL_REASON[reason] });
        const wanted = action === 'resync' ? 'CONNECTED' : 'CALENDAR_REMOVED';
        if (row.state !== wanted) {
            throw new ConflictError(
                action === 'resync' ? 'Only a connected calendar can be resynced.' : 'The Islestone calendar was not deleted; there is nothing to recreate.',
                { reason: 'CALENDAR_CONNECTION_STATE', state: row.state },
            );
        }
        let resynced = 0;
        if (action === 'resync') {
            resynced = await CalendarSyncRepository.dropRemovedInCalendar(db, ctx, row.id);
            await CalendarSyncRepository.setCursor(db, ctx, row.id, null);
        } else if ((await CalendarSyncRepository.markRecreating(db, ctx, row.id)) === 0) {
            throw new ConflictError('The calendar could not be recreated: connect it again.', { reason: 'CALENDAR_CONNECTION_STATE', state: row.state });
        }
        await logEvent(db, ctx, {
            action: action === 'resync' ? 'CALENDAR_RESYNCED' : 'CALENDAR_RECREATED',
            entityType: 'CalendarConnection',
            entityId: row.id,
            details: action === 'resync' ? 'Asked to resync a calendar' : 'Asked to recreate the Islestone calendar',
            detailsJson:
                action === 'resync'
                    ? { category: 'entity_lifecycle', entityName: 'CalendarConnection', operation: 'updated', summary: 'resync' }
                    : { category: 'status_change', entityName: 'CalendarConnection', fromStatus: 'CALENDAR_REMOVED', toStatus: 'CONNECTED' },
            metadata: { provider, ...(action === 'resync' ? { eventsPutBack: resynced } : {}) },
        });
        return { id: row.id, resynced };
    });
    await enqueueConnectionSync(ctx.tenantId, [result.id]);
    return { state: 'CONNECTED', resynced: result.resynced };
}
