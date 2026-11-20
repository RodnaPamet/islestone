/**
 * The intake bells (sub-phase 2.6a; owner decisions 90 and 95):
 *
 *   - `INTAKE_REQUEST_RECEIVED`: a new request, to each member on the
 *     project's notify list (never the person who sent it);
 *   - `INTAKE_REQUEST_WOKEN`: a snoozed request came back, to whoever snoozed it.
 *
 * Mirrors `work-item-due.ts`: each recipient's preference under the
 * workspace's in-app mute list is asked before
 * any write, one `createMany({ skipDuplicates })` per batch, one read-back of
 * the inserted ids, then a push per inserted row. The title is the stored
 * English the settings API lists (2.7 decides about stored keys). The body
 * names the project's key prefix and the request's title, which the
 * recipients may read (they hold `intake.view`, re-checked by the caller).
 *
 * Kept in `notifications/`, never `jobs/`: the usecases import it.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { tenantIntakeRequestPath } from '@/lib/intake/paths';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

export const INTAKE_RECEIVED_NOTIFICATION_TYPE = 'INTAKE_REQUEST_RECEIVED' as const;
export const INTAKE_WOKEN_NOTIFICATION_TYPE = 'INTAKE_REQUEST_WOKEN' as const;

export const INTAKE_NOTIFICATION_COPY = {
    [INTAKE_RECEIVED_NOTIFICATION_TYPE]: { title: 'New intake request', phrase: 'arrived in intake' },
    [INTAKE_WOKEN_NOTIFICATION_TYPE]: { title: 'Snoozed request is back', phrase: 'is back in intake' },
} as const;

export type IntakeNotificationType = keyof typeof INTAKE_NOTIFICATION_COPY;

export interface IntakeBellTarget {
    requestId: string;
    projectKeyPrefix: string;
    title: string;
    recipientUserIds: readonly string[];
}

type IntakeDb = Pick<PrismaClient, 'notification' | 'tenantNotificationSettings' | 'notificationPreference'>;

/** One bell per request and recipient (`WOKEN` also per wake day, so a second snooze can ring again). */
export function buildIntakeDedupeKey(tenantId: string, type: IntakeNotificationType, requestId: string, userId: string, day?: string): string {
    return `${tenantId}:${type}:${requestId}:${userId}${day ? `:${day}` : ''}`;
}

export async function createIntakeNotifications(
    db: IntakeDb,
    tenantId: string,
    tenantSlug: string,
    type: IntakeNotificationType,
    targets: readonly IntakeBellTarget[],
    opts: { day?: string } = {},
): Promise<{ created: number; muted: boolean }> {
    const copy = INTAKE_NOTIFICATION_COPY[type];
    const all = targets.flatMap((t) =>
        [...new Set(t.recipientUserIds)].map((userId) => ({
            tenantId,
            userId,
            type,
            title: copy.title,
            body: `${t.projectKeyPrefix}: "${t.title}" ${copy.phrase}.`,
            linkUrl: tenantIntakeRequestPath(tenantSlug, t.requestId),
            dedupeKey: buildIntakeDedupeKey(tenantId, type, t.requestId, userId, opts.day),
        })),
    );
    if (all.length === 0) return { created: 0, muted: false };
    // Above the write: a muted row would still reach the bell list and the
    // stream. One batch read: each recipient's preference under the
    // workspace's mute list (2.7c).
    const enabled = await isInAppTypeEnabled(db, tenantId, type, all.map((r) => r.userId));
    const rows = all.filter((r) => enabled.has(r.userId));
    if (rows.length === 0) return { created: 0, muted: true };
    const result = await db.notification.createMany({ data: rows, skipDuplicates: true });
    if (result.count > 0) {
        const inserted = await insertedNotificationIds(db, tenantId, rows.map((r) => r.dedupeKey));
        for (const row of rows) {
            const written = inserted.get(row.dedupeKey);
            if (!written) continue;
            publishNotificationEvent(tenantId, row.userId, {
                id: written.id,
                type: row.type,
                title: row.title,
                body: row.body,
                read: false,
                linkUrl: row.linkUrl,
                createdAt: written.createdAt.toISOString(),
            });
        }
    }
    return { created: result.count, muted: false };
}
