/**
 * Nightly job: notification retention (sub-phase 2.7c; owner decision 135).
 *
 * The workspaces holding a notification past its window (Done more than 90
 * days ago, or read more than 180 days ago) are found under
 * `runWithoutRls({ reason: 'cross-tenant-sweep' })`, deleted workspaces
 * skipped; each is then purged INSIDE its own context as its system user
 * (`purgeExpiredNotifications`). Unread rows are kept. Idempotent: a re-run
 * finds nothing past the window that it has not already deleted.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import {
    NOTIFICATION_DONE_RETENTION_DAYS,
    NOTIFICATION_READ_RETENTION_DAYS,
    purgeExpiredNotifications,
} from '../usecases/notification-retention';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

const TENANT_SWEEP_TAKE = 100_000;
const MS_PER_DAY = 86_400_000;

export interface NotificationPurgeOptions {
    tenantId?: string;
    now?: Date;
}

export interface NotificationPurgeResult {
    tenants: number;
    failedTenants: number;
    purged: number;
}

/** The live workspaces with at least one notification past its window. */
async function tenantsToPurge(tenantId: string | undefined, now: Date) {
    const doneBefore = new Date(now.getTime() - NOTIFICATION_DONE_RETENTION_DAYS * MS_PER_DAY);
    const readBefore = new Date(now.getTime() - NOTIFICATION_READ_RETENTION_DAYS * MS_PER_DAY);
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
        const rows = await db.notification.findMany({
            where: {
                ...(tenantId ? { tenantId } : {}),
                tenant: { deletedAt: null },
                OR: [
                    { archivedAt: { lt: doneBefore } },
                    { archivedAt: null, read: true, readAt: { lt: readBefore } },
                    { archivedAt: null, read: true, readAt: null, createdAt: { lt: readBefore } },
                ],
            },
            distinct: ['tenantId'],
            take: TENANT_SWEEP_TAKE,
            select: { tenantId: true },
        });
        const ids = rows.map((r) => r.tenantId);
        if (ids.length === 0) return [];
        return db.tenant.findMany({
            where: { id: { in: ids }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        });
    });
}

export async function processNotificationPurge(options: NotificationPurgeOptions = {}): Promise<NotificationPurgeResult> {
    return runJob('notification-purge', async () => {
        const now = options.now ?? new Date();
        const result: NotificationPurgeResult = { tenants: 0, failedTenants: 0, purged: 0 };
        for (const tenant of await tenantsToPurge(options.tenantId, now)) {
            try {
                const ctx = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'notification-purge' });
                result.purged += (await purgeExpiredNotifications(ctx, now)).purged;
                result.tenants += 1;
            } catch (err) {
                result.failedTenants += 1;
                logger.error('notification purge failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('notification purge finished', { component: 'jobs', ...result });
        return result;
    });
}
