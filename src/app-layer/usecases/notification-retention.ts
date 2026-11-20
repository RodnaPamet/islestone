/**
 * Notification retention (sub-phase 2.7c; owner decision 135): in one
 * workspace, delete the notifications marked Done more than
 * `NOTIFICATION_DONE_RETENTION_DAYS` (90) ago and the read ones (not Done) read
 * more than `NOTIFICATION_READ_RETENTION_DAYS` (180) ago, counting from
 * `createdAt` for a row read before `readAt` existed. Unread rows still in the
 * Inbox are kept, however old: nothing a member has not seen is lost.
 *
 * Bounded batches, each in its own transaction with a counts-only audit
 * entry (`NOTIFICATIONS_PURGED`); the notification's text is never in it.
 * Called by the `notification-purge` job as the workspace's system user.
 *
 * Written fresh for Islestone.
 */
import { runInTenantContext } from '@/lib/db-context';

import { logEvent } from '../events/audit';
import { NotificationRepository } from '../repositories/NotificationRepository';
import type { RequestContext } from '../types';

export const NOTIFICATION_DONE_RETENTION_DAYS = 90;
export const NOTIFICATION_READ_RETENTION_DAYS = 180;
/** Rows per batch, and the batches one run takes per workspace (the next night continues). */
export const NOTIFICATION_PURGE_BATCH = 2_000;
const MAX_BATCHES = 50;
const MS_PER_DAY = 86_400_000;

export async function purgeExpiredNotifications(ctx: RequestContext, now: Date = new Date()): Promise<{ purged: number }> {
    const cut = {
        doneBefore: new Date(now.getTime() - NOTIFICATION_DONE_RETENTION_DAYS * MS_PER_DAY),
        readBefore: new Date(now.getTime() - NOTIFICATION_READ_RETENTION_DAYS * MS_PER_DAY),
    };
    let purged = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
        // guardrail-allow: n+1 — one transaction per bounded batch.
        const n = await runInTenantContext(ctx, async (db) => {
            const ids = await NotificationRepository.purgeableIds(db, ctx.tenantId, cut, NOTIFICATION_PURGE_BATCH);
            const count = await NotificationRepository.deleteByIds(db, ctx.tenantId, ids);
            if (count > 0) {
                await logEvent(db, ctx, {
                    action: 'NOTIFICATIONS_PURGED',
                    entityType: 'Notification',
                    entityId: ctx.tenantId,
                    details: `Purged ${count} notification(s) past retention`,
                    detailsJson: {
                        category: 'data_lifecycle',
                        operation: 'purged',
                        recordCount: count,
                        model: 'Notification',
                        reason: 'done_90_read_180',
                        graceDays: NOTIFICATION_DONE_RETENTION_DAYS,
                    },
                });
            }
            return { count, full: ids.length === NOTIFICATION_PURGE_BATCH };
        });
        purged += n.count;
        if (!n.full) break;
    }
    return { purged };
}
