/**
 * Daily job: the cycle rollover (sub-phase 2.5a, owner decisions 63 and 64).
 *
 * Runs just after midnight in `NOTIFICATIONS_TZ`, so "today" is the day after
 * a cycle's last day in the zone the due reminders use. The workspaces to
 * visit (an open cycle, or a cycle schedule) are found under
 * `runWithoutRls({ reason: 'cross-tenant-sweep' })`, deleted workspaces
 * skipped; each is then rolled over INSIDE its own context as its system
 * user (`buildTenantSystemJobContext`): the job acts for nobody.
 *
 * Idempotent at the data layer, not through the BullMQ job id
 * (`schedules.ts`): a cycle is closed by a conditional update, and the
 * schedule's windows are deterministic and refused twice by the overlap
 * check, so a re-run the same day changes nothing.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { rolloverWorkspaceCycles, type RolloverResult } from '../usecases/cycle-rollover';
import { todayInTz } from '../notifications/work-item-due';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export interface CycleRolloverOptions {
    tenantId?: string;
    now?: Date;
    tz?: string;
}

export interface CycleRolloverJobResult extends RolloverResult {
    tenants: number;
    failedTenants: number;
}

/** A sweep over every workspace; bounded far above any deployment. */
const TENANT_SWEEP_TAKE = 100_000;

async function tenantsToVisit(tenantId: string | undefined): Promise<Array<{ id: string; slug: string }>> {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
        const scope = tenantId ? { tenantId } : {};
        const [cycles, schedules] = await Promise.all([
            db.cycle.findMany({
                where: { ...scope, completedAt: null, tenant: { deletedAt: null } },
                distinct: ['tenantId'],
                take: TENANT_SWEEP_TAKE,
                select: { tenantId: true },
            }),
            db.cycleSchedule.findMany({
                where: { ...scope, enabled: true, tenant: { deletedAt: null } },
                distinct: ['tenantId'],
                take: TENANT_SWEEP_TAKE,
                select: { tenantId: true },
            }),
        ]);
        const ids = [...new Set([...cycles, ...schedules].map((r) => r.tenantId))];
        if (ids.length === 0) return [];
        return db.tenant.findMany({
            where: { id: { in: ids }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        });
    });
}

export async function processCycleRollover(options: CycleRolloverOptions = {}): Promise<CycleRolloverJobResult> {
    return runJob('cycle-rollover', async () => {
        const now = options.now ?? new Date();
        const tz = options.tz ?? ((env.NOTIFICATIONS_TZ as string | undefined) || 'UTC');
        const today = todayInTz(now, tz);
        const result: CycleRolloverJobResult = { tenants: 0, failedTenants: 0, teams: 0, cyclesCreated: 0, cyclesClosed: 0, itemsMoved: 0 };
        for (const tenant of await tenantsToVisit(options.tenantId)) {
            try {
                const ctx = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'cycle-rollover' });
                const r = await rolloverWorkspaceCycles(ctx, today, now);
                result.tenants += 1;
                result.teams += r.teams;
                result.cyclesCreated += r.cyclesCreated;
                result.cyclesClosed += r.cyclesClosed;
                result.itemsMoved += r.itemsMoved;
            } catch (err) {
                // One workspace's failure never stops the others; the next run retries it.
                result.failedTenants += 1;
                logger.error('cycle rollover failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('cycle rollover finished', { component: 'jobs', ...result, today: today.toISOString().slice(0, 10) });
        return result;
    });
}
