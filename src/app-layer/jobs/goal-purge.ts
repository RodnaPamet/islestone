/**
 * Nightly job: the goal purge (sub-phase 3.2a; owner decision 219).
 *
 * The workspaces holding goals or initiatives deleted before the window are
 * found under `runWithoutRls({ reason: 'cross-tenant-sweep' })`, live
 * workspaces only, and each is then purged INSIDE its own context, as its
 * system user (`purgeWorkspaceGoals`). The window is `GOAL_PURGE_DAYS` (30).
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { purgeWorkspaceGoals } from '../usecases/goal-purge';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export interface GoalPurgeOptions {
    tenantId?: string;
    now?: Date;
    windowDays?: number;
}

export interface GoalPurgeResult {
    tenants: number;
    goals: number;
    initiatives: number;
    projectsUnlinked: number;
    itemsUnlinked: number;
}

export function goalPurgeWindowDays(): number {
    const n = Number(env.GOAL_PURGE_DAYS);
    return Number.isInteger(n) && n >= 1 ? n : 30;
}

export async function processGoalPurge(options: GoalPurgeOptions = {}): Promise<GoalPurgeResult> {
    return runJob('goal-purge', async () => {
        const windowDays = options.windowDays ?? goalPurgeWindowDays();
        const before = new Date((options.now ?? new Date()).getTime() - windowDays * 86_400_000);
        const tenantIds = await runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
            const where = { deletedAt: { lt: before }, tenant: { deletedAt: null }, ...(options.tenantId ? { tenantId: options.tenantId } : {}) };
            const [goals, initiatives] = await Promise.all([
                db.goal.groupBy({ by: ['tenantId'], where }),
                db.initiative.groupBy({ by: ['tenantId'], where }),
            ]);
            return [...new Set([...goals, ...initiatives].map((r) => r.tenantId))].sort();
        });
        const result: GoalPurgeResult = { tenants: 0, goals: 0, initiatives: 0, projectsUnlinked: 0, itemsUnlinked: 0 };
        for (const tenantId of tenantIds) {
            const ctx = await buildTenantSystemJobContext({ tenantId, job: 'goal-purge' });
            const r = await purgeWorkspaceGoals(ctx, before, windowDays);
            result.tenants += 1;
            result.goals += r.goals;
            result.initiatives += r.initiatives;
            result.projectsUnlinked += r.projectsUnlinked;
            result.itemsUnlinked += r.itemsUnlinked;
        }
        logger.info('goal purge finished', { component: 'jobs', ...result, windowDays });
        return result;
    });
}
