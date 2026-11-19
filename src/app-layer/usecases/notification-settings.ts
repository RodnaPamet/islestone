/**
 * The workspace's notification settings: read them (with the outbox stats
 * and the in-app type catalogue), change them, and drain this workspace's
 * outbox now. The routes under `/api/t/:slug/notification-settings` call
 * these; they hold the policy check and the data access the routes did in
 * inflect-compliance (`src/app/api/t/[tenantSlug]/notification-settings/` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e), moved here because Islestone's
 * route handlers parse, call a usecase and respond (CLAUDE.md, "Layer rules").
 *
 * Each also passes `requirePermission('admin.manage')` at its route, so a
 * refusal writes an AUTHZ_DENIED row; `assertCanAdmin` here admits the same
 * OWNER + ADMIN set.
 */
import { runInTenantContext } from '@/lib/db-context';

import { logEvent } from '../events/audit';
import { listInAppNotificationTypes } from '../notifications/in-app-types';
import { processOutbox } from '../notifications/processOutbox';
import type { ProcessOutboxResult } from '../notifications/processOutbox';
import {
    getOutboxStats,
    getTenantNotificationSettings,
    updateTenantNotificationSettings,
} from '../notifications/settings';
import type { TenantNotificationSettingsData } from '../notifications/settings';
import { assertCanAdmin } from '../policies/common';
import type { UpdateNotificationSettingsInput } from '../schemas/notification-settings.schemas';
import type { RequestContext } from '../types';

/** Rows one manual drain sends at most (the scheduled tick sends 200). */
export const MANUAL_OUTBOX_DRAIN_LIMIT = 100;

/**
 * Settings, outbox stats, and the in-app type catalogue joined to this
 * workspace's mute list. The catalogue is resolved SERVER-side from the
 * emitters' own copy (`in-app-types.ts`), so a client renders whatever this
 * lists: a new in-app type reaches the preference page without a client
 * edit, and a type the emitters stopped sending disappears from it.
 */
export async function getNotificationSettingsView(ctx: RequestContext) {
    assertCanAdmin(ctx);
    const [settings, stats] = await runInTenantContext(ctx, (db) =>
        Promise.all([getTenantNotificationSettings(db, ctx.tenantId), getOutboxStats(db, ctx.tenantId)]),
    );
    const inAppTypes = listInAppNotificationTypes().map((info) => ({
        ...info,
        muted: settings.mutedInAppTypes.includes(info.type),
    }));
    return { settings, stats, inAppTypes };
}

/** Change the settings (a partial update); audited by the settings service. */
export async function updateNotificationSettings(
    ctx: RequestContext,
    input: UpdateNotificationSettingsInput,
): Promise<TenantNotificationSettingsData> {
    assertCanAdmin(ctx);
    return runInTenantContext(ctx, (db) => updateTenantNotificationSettings(db, ctx, input));
}

/**
 * Drain THIS workspace's outbox now. Scoped to the workspace on purpose: an
 * unscoped `processOutbox` sends every workspace's mail, and in
 * inflect-compliance this action once did, reporting the combined total to a
 * single workspace's admin. Audited, because it sends mail on the caller's
 * word.
 */
export async function drainWorkspaceOutbox(ctx: RequestContext): Promise<ProcessOutboxResult> {
    assertCanAdmin(ctx);
    const stats = await processOutbox({ limit: MANUAL_OUTBOX_DRAIN_LIMIT, tenantId: ctx.tenantId });
    await runInTenantContext(ctx, (db) =>
        logEvent(db, ctx, {
            action: 'NOTIFICATION_OUTBOX_PROCESSED',
            entityType: 'TenantNotificationSettings',
            entityId: ctx.tenantId,
            details: `Processed the workspace outbox: ${stats.sent} sent, ${stats.failed} failed, ${stats.skipped} skipped`,
            detailsJson: {
                category: 'custom',
                trigger: 'manual',
                limit: MANUAL_OUTBOX_DRAIN_LIMIT,
                sent: stats.sent,
                failed: stats.failed,
                skipped: stats.skipped,
            },
        }),
    );
    return stats;
}
