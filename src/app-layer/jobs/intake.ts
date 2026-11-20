/**
 * The two daily intake jobs (sub-phase 2.6a; owner decision 90):
 *
 *   - `intake-snooze-wake`: 08:00 in `NOTIFICATIONS_TZ`, so "today" is the
 *     reader's today and the woken request is back at the start of their day;
 *   - `intake-purge`: decided requests past the retention window.
 *
 * The workspaces to visit (a snoozed request due, or a decided request) are
 * found under `runWithoutRls({ reason: 'cross-tenant-sweep' })`, deleted
 * workspaces skipped; each is then handled INSIDE its own context as its
 * system user (`buildTenantSystemJobContext`). Idempotent at the data layer:
 * the wake and the purge are conditional, so a re-run finds nothing to do.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { purgeDecidedRequests, wakeSnoozedRequests } from '../usecases/intake-jobs';
import { todayInTz } from '../notifications/work-item-due';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

/** A sweep over every workspace; bounded far above any deployment. */
const TENANT_SWEEP_TAKE = 100_000;

async function tenantsWith(statuses: ('SNOOZED' | 'ACCEPTED' | 'DECLINED' | 'MERGED')[], tenantId: string | undefined) {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
        const rows = await db.intakeRequest.findMany({
            where: { ...(tenantId ? { tenantId } : {}), status: { in: statuses }, tenant: { deletedAt: null } },
            distinct: ['tenantId'],
            take: TENANT_SWEEP_TAKE,
            select: { tenantId: true },
        });
        if (rows.length === 0) return [];
        return db.tenant.findMany({
            where: { id: { in: rows.map((r) => r.tenantId) }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        });
    });
}

export interface IntakeJobOptions {
    tenantId?: string;
    now?: Date;
    tz?: string;
}

export interface IntakeJobResult {
    tenants: number;
    failedTenants: number;
    count: number;
}

export async function processIntakeSnoozeWake(options: IntakeJobOptions = {}): Promise<IntakeJobResult> {
    return runJob('intake-snooze-wake', async () => {
        const now = options.now ?? new Date();
        const tz = options.tz ?? ((env.NOTIFICATIONS_TZ as string | undefined) || 'UTC');
        const today = todayInTz(now, tz);
        const result: IntakeJobResult = { tenants: 0, failedTenants: 0, count: 0 };
        for (const tenant of await tenantsWith(['SNOOZED'], options.tenantId)) {
            try {
                const ctx = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'intake-snooze-wake' });
                result.count += (await wakeSnoozedRequests(ctx, today)).woken;
                result.tenants += 1;
            } catch (err) {
                // One workspace's failure never stops the others; the next run retries it.
                result.failedTenants += 1;
                logger.error('intake snooze wake failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('intake snooze wake finished', { component: 'jobs', ...result, today: today.toISOString().slice(0, 10) });
        return result;
    });
}

export async function processIntakePurge(options: IntakeJobOptions = {}): Promise<IntakeJobResult> {
    return runJob('intake-purge', async () => {
        const now = options.now ?? new Date();
        const result: IntakeJobResult = { tenants: 0, failedTenants: 0, count: 0 };
        for (const tenant of await tenantsWith(['ACCEPTED', 'DECLINED', 'MERGED'], options.tenantId)) {
            try {
                const ctx = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'intake-purge' });
                result.count += (await purgeDecidedRequests(ctx, now)).purged;
                result.tenants += 1;
            } catch (err) {
                result.failedTenants += 1;
                logger.error('intake purge failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('intake purge finished', { component: 'jobs', ...result });
        return result;
    });
}
