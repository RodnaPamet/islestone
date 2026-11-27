/**
 * Nightly job: hard-delete page groups soft-deleted more than
 * `PAGE_PURGE_DAYS` (30) ago (sub-phase 4.1a, owner decision 344), every
 * live workspace as its system user. Idempotent: a page already gone is not
 * counted again, and every finished pass is committed.
 *
 * Written fresh for Islestone (the shape of `goal-purge.ts`).
 */
import { buildTenantSystemJobContext } from '../context-system';
import { purgeWorkspacePages } from '../usecases/page-purge';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export interface PagePurgeOptions {
    tenantId?: string;
    now?: Date;
    windowDays?: number;
}

export interface PagePurgeResult {
    tenants: number;
    pages: number;
    groups: number;
}

export function pagePurgeWindowDays(): number {
    const n = Number(env.PAGE_PURGE_DAYS);
    return Number.isInteger(n) && n >= 1 ? n : 30;
}

export async function processPagePurge(options: PagePurgeOptions = {}): Promise<PagePurgeResult> {
    return runJob('page-purge', async () => {
        const windowDays = options.windowDays ?? pagePurgeWindowDays();
        const before = new Date((options.now ?? new Date()).getTime() - windowDays * 86_400_000);
        const tenantIds = await runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
            const rows = await db.page.groupBy({
                by: ['tenantId'],
                where: { deletedAt: { lt: before }, tenant: { deletedAt: null }, ...(options.tenantId ? { tenantId: options.tenantId } : {}) },
            });
            return rows.map((r) => r.tenantId).sort();
        });
        const result: PagePurgeResult = { tenants: 0, pages: 0, groups: 0 };
        for (const tenantId of tenantIds) {
            const ctx = await buildTenantSystemJobContext({ tenantId, job: 'page-purge' });
            const r = await purgeWorkspacePages(ctx, before, windowDays);
            result.tenants += 1;
            result.pages += r.pages;
            result.groups += r.groups;
        }
        logger.info('page purge finished', { component: 'jobs', ...result, windowDays });
        return result;
    });
}
