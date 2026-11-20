/**
 * A member's notification preferences (sub-phase 2.7c; owner decision 132):
 * read them with the defaults filled and the workspace's ceiling applied, and
 * change them. No permission key: a member manages their own, as the bell's
 * routes do (`assertCanRead`); every row is keyed by the caller's own user id.
 *
 * Written fresh for Islestone.
 */
import type { NotificationPreference } from '@prisma/client';

import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { badRequest } from '@/lib/errors/types';
import type { PreferenceRowData, PreferencesData } from '@/lib/notifications/inbox';
import {
    choiceRefusal,
    EMAIL_DELIVERIES,
    offersImmediateEmail,
    PREFERENCE_TYPES,
    resolveDelivery,
    type PreferenceCeiling,
} from '@/lib/notifications/preferences';
import type { UpdatePreferencesInput } from '@/lib/schemas/notifications';

import { logEvent } from '../events/audit';
import { getTenantNotificationSettings } from '../notifications/settings';
import { assertCanRead } from '../policies/common';
import type { RequestContext } from '../types';

async function readState(db: PrismaTx, ctx: RequestContext): Promise<{ ceiling: PreferenceCeiling; rows: NotificationPreference[] }> {
    const [settings, rows] = await Promise.all([
        getTenantNotificationSettings(db, ctx.tenantId),
        db.notificationPreference.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId },
            take: PREFERENCE_TYPES.length + 1,
        }),
    ]);
    return { ceiling: { emailEnabled: settings.enabled, mutedInAppTypes: settings.mutedInAppTypes }, rows };
}

function project(ceiling: PreferenceCeiling, rows: readonly NotificationPreference[]): PreferencesData {
    const stored = new Map(rows.map((r) => [r.type, r]));
    const out: PreferenceRowData[] = PREFERENCE_TYPES.map((type) => {
        const r = resolveDelivery(type, stored.get(type) ?? null, ceiling);
        return {
            type,
            inApp: r.chosen.inApp,
            email: r.chosen.email,
            isDefault: r.isDefault,
            effectiveInApp: r.inApp,
            effectiveEmail: r.email,
            inAppCap: r.inAppCap,
            emailCap: r.emailCap,
            emailChoices: EMAIL_DELIVERIES.filter((d) => d !== 'IMMEDIATE' || offersImmediateEmail(type)),
        };
    });
    return { rows: out, workspace: { emailEnabled: ceiling.emailEnabled, mutedInAppTypes: [...ceiling.mutedInAppTypes] } };
}

export async function getMyNotificationPreferences(ctx: RequestContext): Promise<PreferencesData> {
    assertCanRead(ctx);
    return runInTenantContext(ctx, async (db) => {
        const { ceiling, rows } = await readState(db, ctx);
        return project(ceiling, rows);
    });
}

/**
 * Change some types (a partial update): a choice is stored as the member's
 * row, `reset` deletes it so the type's default applies again. A choice the
 * type does not offer is a 400 naming why (`IMMEDIATE_NOT_OFFERED`,
 * `DAILY_NEEDS_IN_APP`); the migration's CHECK holds the first for every
 * writer. Audited `NOTIFICATION_PREFERENCES_UPDATED` with the changed types and
 * their values, before and after (configuration, no personal data).
 */
export async function updateMyNotificationPreferences(ctx: RequestContext, input: UpdatePreferencesInput): Promise<PreferencesData> {
    assertCanRead(ctx);
    const seen = new Set<string>();
    for (const row of input.rows) {
        if (seen.has(row.type)) throw badRequest(`${row.type} is named twice.`, { reason: 'DUPLICATE_TYPE', type: row.type });
        seen.add(row.type);
        if ('reset' in row) continue;
        const refusal = choiceRefusal(row.type, { inApp: row.inApp, email: row.email });
        if (refusal) {
            throw badRequest(
                refusal === 'IMMEDIATE_NOT_OFFERED'
                    ? `Immediate email is not offered for ${row.type}.`
                    : `The daily digest lists ${row.type} notifications from the bell, so it needs the bell on.`,
                { reason: refusal, type: row.type },
            );
        }
    }
    return runInTenantContext(ctx, async (db) => {
        const before = await readState(db, ctx);
        const beforeView = project(before.ceiling, before.rows);
        for (const row of input.rows) {
            const key = { tenantId_userId_type: { tenantId: ctx.tenantId, userId: ctx.userId, type: row.type } };
            if ('reset' in row) {
                // guardrail-allow: n+1 — at most one write per notification type (six).
                await db.notificationPreference.deleteMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId, type: row.type } });
                continue;
            }
            // guardrail-allow: n+1 — at most one write per notification type (six).
            await db.notificationPreference.upsert({
                where: key,
                create: { tenantId: ctx.tenantId, userId: ctx.userId, type: row.type, inApp: row.inApp, emailDelivery: row.email },
                update: { inApp: row.inApp, emailDelivery: row.email },
            });
        }
        const after = await readState(db, ctx);
        const afterView = project(after.ceiling, after.rows);
        const describe = (v: PreferencesData) =>
            Object.fromEntries(v.rows.map((r) => [r.type, { inApp: r.inApp, email: r.email, isDefault: r.isDefault }]));
        const b = describe(beforeView);
        const a = describe(afterView);
        const changed = PREFERENCE_TYPES.filter((t) => JSON.stringify(b[t]) !== JSON.stringify(a[t]));
        if (changed.length > 0) {
            await logEvent(db, ctx, {
                action: 'NOTIFICATION_PREFERENCES_UPDATED',
                entityType: 'NotificationPreference',
                entityId: ctx.userId,
                details: `Updated notification preferences: ${changed.join(', ')}`,
                detailsJson: {
                    category: 'entity_lifecycle',
                    entityName: 'NotificationPreference',
                    operation: 'updated',
                    changedFields: [...changed],
                    before: Object.fromEntries(changed.map((t) => [t, b[t]])),
                    after: Object.fromEntries(changed.map((t) => [t, a[t]])),
                },
            });
        }
        return afterView;
    });
}
