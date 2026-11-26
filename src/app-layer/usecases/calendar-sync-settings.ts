/**
 * Settings → Calendar sync (roadmap 3.3b; ADR 0011 §5 and §6; owner decisions
 * 234 and 237): the workspace's switch and Microsoft 365's admin consent,
 * under `integrations.manage`.
 *
 * Turning the switch off, and withdrawing Microsoft's consent, tear down every
 * affected connection (decision 239): each moves to DISCONNECTING in the same
 * transaction and its teardown is queued after the commit. The page shows how
 * many members are connected, never who.
 *
 * The consent flow is copied from inflect-compliance
 * `src/app-layer/usecases/tenant-calendar-consent.ts` and its two routes at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and adapted: one settings
 * row with the switch instead of a consent row per provider; the state sealed
 * and bound to the admin who started it; the directory id checked as a GUID;
 * withdrawing tears the connections down (inflect left them to fail).
 *
 * Audited `CALENDAR_SYNC_SETTINGS_SET`, `CALENDAR_MICROSOFT_CONSENT_GRANTED`
 * and `_REVOKED`; never a token or a provider's text.
 */
import type { TenantCalendarSettings } from '@prisma/client';

import { logEvent } from '../events/audit';
import { MICROSOFT_DIRECTORY_ID, buildMicrosoftAdminConsentUrl } from '../integrations/providers/calendar/token';
import { assertMayManageCalendarSync } from '../policies/calendar-sync.policies';
import { assertActingAsPerson } from '../policies/person-only.policies';
import { CalendarSyncRepository } from '../repositories/CalendarSyncRepository';
import type { RequestContext } from '../types';
import { enqueueTeardowns } from './calendar-sync-enqueue';
import { appLink } from '@/app-layer/notifications/app-link';
import { ADMIN_STATE_COOKIE, newOAuthSecrets, sealOAuthState } from '@/lib/calendar-sync/oauth-state';
import { isProviderConfigured } from '@/lib/calendar-sync/switch';
import type { CalendarSyncSettingsView } from '@/lib/calendar-sync/types';
import { runInTenantContext, runInTenantReadContext, type PrismaTx } from '@/lib/db-context';
import { ConflictError, ValidationError } from '@/lib/errors/types';

/** The most connections one change of the switch moves at once; the dispatcher tears down the rest. */
export const SETTINGS_TEARDOWN_CAP = 5_000;

export const ADMIN_CALLBACK_PATH = '/api/integrations/calendar/admin-callback';
export const CONNECT_CALLBACK_PATH = '/api/integrations/calendar/callback';

/** An absolute callback URL on the deployment's public origin, or null when it has none. */
export function absoluteCallback(path: string): string | null {
    const url = appLink(path);
    return /^https?:\/\//.test(url) ? url : null;
}

export function microsoftConsentGranted(s: Pick<TenantCalendarSettings, 'microsoftConsentGrantedAt' | 'microsoftConsentRevokedAt' | 'microsoftExternalTenantId'> | null): boolean {
    return Boolean(s?.microsoftConsentGrantedAt && !s.microsoftConsentRevokedAt && s.microsoftExternalTenantId);
}

async function viewOf(db: PrismaTx, ctx: RequestContext, s: TenantCalendarSettings | null): Promise<CalendarSyncSettingsView> {
    const counts = await CalendarSyncRepository.countsByProvider(db, ctx);
    const count = (provider: 'GOOGLE' | 'MICROSOFT') => counts.filter((c) => c.provider === provider && c.state === 'CONNECTED').reduce((n, c) => n + c._count._all, 0);
    return {
        syncEnabled: s?.syncEnabled ?? false,
        version: s?.version ?? 0,
        google: { configured: isProviderConfigured('GOOGLE'), connected: count('GOOGLE') },
        microsoft: {
            configured: isProviderConfigured('MICROSOFT'),
            connected: count('MICROSOFT'),
            consentGranted: microsoftConsentGranted(s),
            consentGrantedAt: s?.microsoftConsentGrantedAt?.toISOString() ?? null,
            consentRevokedAt: s?.microsoftConsentRevokedAt?.toISOString() ?? null,
        },
        removing: counts.filter((c) => c.state === 'DISCONNECTING').reduce((n, c) => n + c._count._all, 0),
    };
}

export async function getCalendarSyncSettings(ctx: RequestContext): Promise<CalendarSyncSettingsView> {
    assertMayManageCalendarSync(ctx);
    return runInTenantReadContext(ctx, async (db) => viewOf(db, ctx, await CalendarSyncRepository.settings(db, ctx)));
}

/** Decision 234: "Allow members to sync their calendars". Off tears every connection down. */
export async function setCalendarSyncEnabled(ctx: RequestContext, input: { syncEnabled: boolean }): Promise<CalendarSyncSettingsView> {
    assertMayManageCalendarSync(ctx);
    const out = await runInTenantContext(ctx, async (db) => {
        const before = await CalendarSyncRepository.lockSettings(db, ctx);
        let tornDown: string[] = [];
        if (before.syncEnabled !== input.syncEnabled) {
            const after = await CalendarSyncRepository.updateSettings(db, ctx, { syncEnabled: input.syncEnabled });
            if (!input.syncEnabled) {
                tornDown = (await CalendarSyncRepository.connectionIdsInState(db, ctx, ['CONNECTED', 'REVOKED', 'CALENDAR_REMOVED'], SETTINGS_TEARDOWN_CAP)).map((r) => r.id);
                await CalendarSyncRepository.markDisconnecting(db, ctx, tornDown);
            }
            await logEvent(db, ctx, {
                action: 'CALENDAR_SYNC_SETTINGS_SET',
                entityType: 'TenantCalendarSettings',
                entityId: ctx.tenantId,
                details: `Calendar sync turned ${input.syncEnabled ? 'on' : 'off'}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'TenantCalendarSettings', operation: 'updated', changedFields: ['syncEnabled'], after: { syncEnabled: input.syncEnabled } },
                metadata: { syncEnabled: input.syncEnabled, connectionsTornDown: tornDown.length },
            });
            return { view: await viewOf(db, ctx, after), tornDown };
        }
        return { view: await viewOf(db, ctx, before), tornDown };
    });
    await enqueueTeardowns(ctx.tenantId, out.tornDown);
    return out.view;
}

/**
 * Start "Authorise Microsoft 365" (decision 237): the `/adminconsent` URL for
 * the sign-in app registration with the calendar scope, and the sealed state
 * the callback checks. The admin's browser navigates to it.
 */
export async function startMicrosoftConsent(ctx: RequestContext): Promise<{ consentUrl: string; stateCookie: { name: string; value: string } }> {
    assertMayManageCalendarSync(ctx);
    assertActingAsPerson(ctx, 'Authorising Microsoft 365');
    if (!isProviderConfigured('MICROSOFT')) throw new ConflictError('The Microsoft sign-in app is not configured for this deployment.', { reason: 'PROVIDER_NOT_CONFIGURED' });
    const redirectUri = absoluteCallback(ADMIN_CALLBACK_PATH);
    if (!redirectUri) throw new ConflictError('This deployment has no public address to return to.', { reason: 'NO_PUBLIC_ORIGIN' });
    if (!ctx.tenantSlug) throw new ConflictError('The workspace could not be named.', { reason: 'NO_WORKSPACE_SLUG' });
    const { nonce } = newOAuthSecrets();
    const value = sealOAuthState({ purpose: 'admin-consent', nonce, tenantSlug: ctx.tenantSlug, userId: ctx.userId, provider: 'MICROSOFT' });
    return { consentUrl: buildMicrosoftAdminConsentUrl({ redirectUri, state: nonce }), stateCookie: { name: ADMIN_STATE_COOKIE, value } };
}

/** The admin-consent callback's write: the directory and who granted it (decision 237). */
export async function recordMicrosoftConsent(ctx: RequestContext, input: { directoryId: string }): Promise<void> {
    assertMayManageCalendarSync(ctx);
    assertActingAsPerson(ctx, 'Authorising Microsoft 365');
    const directoryId = input.directoryId.trim().toLowerCase();
    if (!MICROSOFT_DIRECTORY_ID.test(directoryId)) throw new ValidationError('The Microsoft directory id is not one.', { reason: 'INVALID_DIRECTORY' });
    await runInTenantContext(ctx, async (db) => {
        await CalendarSyncRepository.lockSettings(db, ctx);
        await CalendarSyncRepository.updateSettings(db, ctx, {
            microsoftExternalTenantId: directoryId,
            microsoftConsentGrantedAt: new Date(),
            microsoftConsentGrantedByUserId: ctx.userId,
            microsoftConsentRevokedAt: null,
        });
        await logEvent(db, ctx, {
            action: 'CALENDAR_MICROSOFT_CONSENT_GRANTED',
            entityType: 'TenantCalendarSettings',
            entityId: ctx.tenantId,
            details: 'Microsoft 365 calendar access authorised for the workspace',
            detailsJson: { category: 'entity_lifecycle', entityName: 'TenantCalendarSettings', operation: 'updated', changedFields: ['microsoftExternalTenantId', 'microsoftConsentGrantedAt'] },
            metadata: { microsoftDirectoryId: directoryId },
        });
    });
}

/** "Withdraw": the consent stamped revoked, every Microsoft connection torn down. */
export async function withdrawMicrosoftConsent(ctx: RequestContext): Promise<CalendarSyncSettingsView> {
    assertMayManageCalendarSync(ctx);
    const out = await runInTenantContext(ctx, async (db) => {
        const before = await CalendarSyncRepository.lockSettings(db, ctx);
        if (!microsoftConsentGranted(before)) return { view: await viewOf(db, ctx, before), tornDown: [] as string[] };
        const after = await CalendarSyncRepository.updateSettings(db, ctx, { microsoftConsentRevokedAt: new Date() });
        const tornDown = (await CalendarSyncRepository.connectionIdsInState(db, ctx, ['CONNECTED', 'REVOKED', 'CALENDAR_REMOVED'], SETTINGS_TEARDOWN_CAP, 'MICROSOFT')).map((r) => r.id);
        await CalendarSyncRepository.markDisconnecting(db, ctx, tornDown);
        await logEvent(db, ctx, {
            action: 'CALENDAR_MICROSOFT_CONSENT_REVOKED',
            entityType: 'TenantCalendarSettings',
            entityId: ctx.tenantId,
            details: 'Microsoft 365 calendar access withdrawn for the workspace',
            detailsJson: { category: 'entity_lifecycle', entityName: 'TenantCalendarSettings', operation: 'updated', changedFields: ['microsoftConsentRevokedAt'] },
            metadata: { connectionsTornDown: tornDown.length },
        });
        return { view: await viewOf(db, ctx, after), tornDown };
    });
    await enqueueTeardowns(ctx.tenantId, out.tornDown);
    return out.view;
}
