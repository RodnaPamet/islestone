/**
 * The work-item purge for one workspace (ADR 0002 §8): hard-delete the items
 * and projects deleted more than the window ago (`WORK_ITEM_PURGE_DAYS`, 30
 * by owner decision 2026-11-19). Run by the daily `work-item-purge` job as
 * the workspace's system user.
 *
 *   - Items go in batches of 500, each in a transaction of its own, so one
 *     statement never cascades a whole workspace. Relations, labels,
 *     comments, watchers and links cascade from `WorkItem`.
 *   - A purged project's items go first, in batches, then the project row.
 *     A project time was recorded in is held, items and all, while its time
 *     entries remain (3.4b; decisions 261 and 277): an entry keeps its
 *     project. An item purged on its own leaves its entries, which then name
 *     no item ("Deleted item").
 *   - `ProjectKeySequence`, `ProjectKeyPrefix` and `WorkItemKeyAlias` have no
 *     foreign key to what is purged and survive: numbers and prefixes are
 *     never reused.
 *   - One `WORK_ITEM_PURGED` audit entry per run with COUNTS only, never ids
 *     or titles (inflect-compliance `data-lifecycle.ts` line 558's rule).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';

export const PURGE_BATCH = 500;

export interface PurgeOutcome {
    items: number;
    projects: number;
}

export async function purgeWorkspaceWorkItems(ctx: RequestContext, before: Date, windowDays: number): Promise<PurgeOutcome> {
    let items = 0;
    let projects = 0;
    for (;;) {
        // guardrail-allow: n+1 — a batched drain: each pass is one bounded read and one delete, in its own transaction.
        const deleted = await runInTenantContext(ctx, async (db) => {
            const ids = await WorkItemRepository.purgeableIds(db, ctx, before, PURGE_BATCH);
            // The batch and the rows pointing at it, locked in id order (decision 173).
            const locked = await WorkItemRepository.lockPurgeBatch(db, ctx, ids);
            return WorkItemRepository.hardDelete(db, ctx, locked, ids);
        });
        items += deleted;
        if (deleted < PURGE_BATCH) break;
    }
    for (;;) {
        // guardrail-allow: n+1 — one deleted project per pass, drained in bounded batches.
        const [projectId] = await runInTenantContext(ctx, (db) => WorkItemRepository.purgeableProjectIds(db, ctx, before, 1));
        if (!projectId) break;
        for (;;) {
            // guardrail-allow: n+1 — the project's items, a bounded batch per transaction.
            const deleted = await runInTenantContext(ctx, async (db) => {
                const ids = await WorkItemRepository.projectItemIds(db, ctx, projectId, PURGE_BATCH);
                const locked = await WorkItemRepository.lockPurgeBatch(db, ctx, ids);
                return WorkItemRepository.hardDelete(db, ctx, locked, ids);
            });
            items += deleted;
            if (deleted < PURGE_BATCH) break;
        }
        projects += await runInTenantContext(ctx, (db) => WorkItemRepository.hardDeleteProject(db, ctx, projectId));
    }
    if (items > 0 || projects > 0) {
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'WORK_ITEM_PURGED',
                entityType: 'Tenant',
                entityId: ctx.tenantId,
                details: `Purged ${items} work item(s) and ${projects} project(s) deleted more than ${windowDays} days ago`,
                detailsJson: {
                    category: 'data_lifecycle',
                    operation: 'purged',
                    recordCount: items + projects,
                    model: 'WorkItem',
                    reason: 'soft-delete window elapsed',
                    graceDays: windowDays,
                },
                metadata: { items, projects, windowDays },
            }),
        );
    }
    return { items, projects };
}
