/**
 * Daily job: rewrite the sort keys of a sibling group (one parent in one
 * page tree) once any of its keys passes 64 characters (sub-phase 4.1a;
 * ADR 0002 §5's rule, which pages join), keeping its order. Deleted rows
 * keep their place, as the work-item rebalance keeps theirs, so a restore
 * comes back where it was.
 *
 * Each group is rewritten in one transaction that waits its workspace's turn
 * and takes the page-tree lock first (no placement, move or restore changes
 * a key without it), reads the whole order, locks every row in id order
 * (decision 173), then writes the new keys in one statement. A sort key
 * change does not bump a page's version.
 *
 * Written fresh for Islestone (the shape of `work-item-sortkey-rebalance.ts`).
 */
import { buildTenantSystemJobContext } from '../context-system';
import { keysBetween, SORT_KEY_REBALANCE_LENGTH } from '../domain/fractional-index';
import { PageRepository } from '../repositories/PageRepository';
import { inPageTreeQueue, lockPageTree } from '../usecases/page-tree-lock';
import { runInTenantContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

/** Sibling groups one run rewrites per workspace, and the most rows one group may hold. */
const GROUPS_PER_RUN = 500;
const GROUP_ROWS = 20_000;

export interface PageSortKeyRebalanceResult {
    groups: number;
    pages: number;
}

export async function processPageSortKeyRebalance(options: { tenantId?: string } = {}): Promise<PageSortKeyRebalanceResult> {
    return runJob('page-sortkey-rebalance', async () => {
        const tenantIds = await runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
            const rows = await db.$queryRaw<Array<{ tenantId: string }>>`
                SELECT DISTINCT "tenantId" FROM "Page" WHERE length("sortKey") > ${SORT_KEY_REBALANCE_LENGTH}`;
            return rows.map((r) => r.tenantId).filter((t) => !options.tenantId || t === options.tenantId).sort();
        });
        const result: PageSortKeyRebalanceResult = { groups: 0, pages: 0 };
        for (const tenantId of tenantIds) {
            const ctx = await buildTenantSystemJobContext({ tenantId, job: 'page-sortkey-rebalance' });
            const spots = await runInTenantContext(ctx, (db) => PageRepository.siblingGroupsNeedingRebalance(db, ctx, SORT_KEY_REBALANCE_LENGTH, GROUPS_PER_RUN));
            for (const spot of spots) {
                // guardrail-allow: n+1 — one sibling group per transaction, bounded by the groups that need it.
                const rewritten = await inPageTreeQueue(ctx.tenantId, () =>
                    runInTenantContext(
                        ctx,
                        async (db) => {
                            await lockPageTree(db, ctx.tenantId);
                            const ordered = await PageRepository.siblingsInOrder(db, ctx, spot, GROUP_ROWS);
                            const locked = await PageRepository.lockForWrite(db, ctx, ordered.map((r) => r.id));
                            const present = ordered.filter((r) => locked.includes(r.id)).map((r) => r.id);
                            const keys = keysBetween(null, null, present.length);
                            await PageRepository.rewriteSortKeys(db, ctx, locked, present, keys);
                            return present.length;
                        },
                        { timeout: 120_000 },
                    ),
                );
                result.groups += 1;
                result.pages += rewritten;
            }
        }
        logger.info('page sort keys rebalanced', { component: 'jobs', ...result });
        return result;
    });
}
