/**
 * Daily job: rebalance a project's `sortKey`s once any of its keys passes
 * the length bound (64 characters, ADR 0002 §5). Keys grow only when many
 * inserts land in one gap; rewriting the project's items with evenly spaced
 * short keys (`keysBetween(null, null, n)`) keeps their order and resets the
 * growth. `sortKey` is not part of the version, so nothing else changes.
 *
 * Deleted items are rewritten too, in the same order (issue #110). A deleted
 * item keeps its key until the purge, and a restore brings it back with it:
 * left out, a restored item sorted by its old long key among the new short
 * ones instead of in its place, and a project whose only long key was a
 * deleted one was selected and rewritten every night until the purge.
 * Rewritten with the rest, it keeps its place between its old neighbours.
 *
 * Per workspace, inside its context; per project, one transaction holding
 * the project's key-sequence row lock, which every placement in the project
 * takes, so no reorder interleaves with the rewrite.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { keysBetween, SORT_KEY_REBALANCE_LENGTH } from '../domain/fractional-index';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { isLocked } from '../repositories/work-item-locks';
import { runInTenantContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';
import type { CursorPayload } from '@/lib/pagination';

const PAGE = 1000;

export interface SortKeyRebalanceResult {
    projects: number;
    items: number;
}

export async function processSortKeyRebalance(options: { tenantId?: string } = {}): Promise<SortKeyRebalanceResult> {
    return runJob('work-item-sortkey-rebalance', async () => {
        const tenantIds = await runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
            const rows = await db.$queryRaw<Array<{ tenantId: string }>>`
                SELECT DISTINCT "tenantId" FROM "WorkItem" WHERE length("sortKey") > ${SORT_KEY_REBALANCE_LENGTH}`;
            return rows.map((r) => r.tenantId).filter((t) => !options.tenantId || t === options.tenantId);
        });
        const result: SortKeyRebalanceResult = { projects: 0, items: 0 };
        for (const tenantId of tenantIds) {
            const ctx = await buildTenantSystemJobContext({ tenantId, job: 'work-item-sortkey-rebalance' });
            const projectIds = await runInTenantContext(ctx, (db) => WorkItemRepository.projectsNeedingRebalance(db, ctx, SORT_KEY_REBALANCE_LENGTH));
            for (const projectId of projectIds) {
                // guardrail-allow: n+1 — one project per transaction, bounded by the projects that need it.
                const rewritten = await runInTenantContext(
                    ctx,
                    async (db) => {
                        await ProjectRepository.lockSequences(db, ctx, [projectId]);
                        // Read the whole order first, then write: a rewrite during the
                        // keyset walk would move rows behind the cursor.
                        const ordered: string[] = [];
                        let after: CursorPayload | undefined;
                        for (;;) {
                            // guardrail-allow: n+1 — the project's items in order, one bounded page per pass.
                            const page = await WorkItemRepository.orderedPageIncludingDeleted(db, ctx, projectId, after, PAGE);
                            ordered.push(...page.map((r) => r.id));
                            const last = page[page.length - 1];
                            if (page.length < PAGE || !last) break;
                            after = { k: last.sortKey, id: last.id };
                        }
                        // Every row locked in id order before the first rewrite, so
                        // the rewrites (in sort order) never wait on a row while
                        // holding another a bulk writer wants (decision 173).
                        const locked = await WorkItemRepository.lockForWrite(db, ctx, ordered);
                        // A deleted row the purge removed between the read and the
                        // lock is gone; every other row is held now, and no
                        // placement, move or restore changes a key without the
                        // sequence row this transaction holds.
                        const present = ordered.filter((id) => isLocked(locked, id));
                        const keys = keysBetween(null, null, present.length);
                        let i = 0;
                        for (const id of present) {
                            await WorkItemRepository.rewriteSortKey(db, ctx, locked, id, keys[i]!);
                            i += 1;
                        }
                        return i;
                    },
                    { timeout: 120_000 },
                );
                result.projects += 1;
                result.items += rewritten;
            }
        }
        logger.info('work-item sort keys rebalanced', { component: 'jobs', ...result });
        return result;
    });
}
