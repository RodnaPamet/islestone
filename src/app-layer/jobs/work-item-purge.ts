/**
 * Daily job: the work-item purge (ADR 0002 §8).
 *
 * The one place a cross-workspace read is right: the workspaces holding
 * items or projects deleted before the window are found through the
 * `[deletedAt]` indexes under `runWithoutRls({ reason: 'cross-tenant-sweep' })`,
 * and each is then purged INSIDE its own context, as its system user
 * (`purgeWorkspaceWorkItems`). The window is `WORK_ITEM_PURGE_DAYS` (30).
 *
 * The general data-lifecycle job is 8.3's and may fold this in.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { purgeWorkspaceWorkItems } from '../usecases/work-item-purge';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export interface WorkItemPurgeOptions {
    tenantId?: string;
    now?: Date;
    windowDays?: number;
}

export interface WorkItemPurgeResult {
    tenants: number;
    items: number;
    projects: number;
    /** Of `projects`, those left as tombstones for their time entries (issue #117). */
    tombstones: number;
}

export function purgeWindowDays(): number {
    const n = Number(env.WORK_ITEM_PURGE_DAYS);
    return Number.isInteger(n) && n >= 1 ? n : 30;
}

export async function processWorkItemPurge(options: WorkItemPurgeOptions = {}): Promise<WorkItemPurgeResult> {
    return runJob('work-item-purge', async () => {
        const windowDays = options.windowDays ?? purgeWindowDays();
        const before = new Date((options.now ?? new Date()).getTime() - windowDays * 86_400_000);
        const tenantIds = await runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
            const [items, projects] = await Promise.all([
                db.workItem.groupBy({ by: ['tenantId'], where: { deletedAt: { lt: before }, ...(options.tenantId ? { tenantId: options.tenantId } : {}) } }),
                // A tombstone (issue #117) is already purged: it brings no workspace back.
                db.project.groupBy({ by: ['tenantId'], where: { deletedAt: { lt: before }, purgedAt: null, ...(options.tenantId ? { tenantId: options.tenantId } : {}) } }),
            ]);
            return [...new Set([...items, ...projects].map((r) => r.tenantId))].sort();
        });
        const result: WorkItemPurgeResult = { tenants: 0, items: 0, projects: 0, tombstones: 0 };
        for (const tenantId of tenantIds) {
            const ctx = await buildTenantSystemJobContext({ tenantId, job: 'work-item-purge' });
            const r = await purgeWorkspaceWorkItems(ctx, before, windowDays);
            result.tenants += 1;
            result.items += r.items;
            result.projects += r.projects;
            result.tombstones += r.tombstones;
        }
        logger.info('work-item purge finished', { component: 'jobs', ...result, windowDays });
        return result;
    });
}
