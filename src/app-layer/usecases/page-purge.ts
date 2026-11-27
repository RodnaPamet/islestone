/**
 * The page purge, one workspace at a time (sub-phase 4.1a; owner decision
 * 344; docs/pages.md, "Delete, restore and the purge").
 *
 * Hard-deletes the page groups deleted more than `PAGE_PURGE_DAYS` ago:
 * their content rows cascade (from 4.1b to 4.1f also versions, comments,
 * mentions, watchers and search rows). Each pass takes the page-tree lock
 * first, as every delete and restore does, then the group's rows in id order
 * (decision 173), and deletes whole groups only, so a parent is never purged
 * without the rows below it that its group holds (a row deleted earlier, in
 * an older group, went first: a live page's descendants that are not in its
 * group were all deleted before it). One counts-only `PAGES_PURGED` per
 * workspace; never a title.
 *
 * Written fresh for Islestone (the shape of `goal-purge.ts`).
 */
import { logEvent } from '../events/audit';
import { PageRepository, PAGE_SUBTREE_CAP } from '../repositories/PageRepository';
import { inPageTreeQueue, lockPageTree } from './page-tree-lock';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';

/** Groups purged per transaction: each holds at most `PAGE_SUBTREE_CAP` rows. */
export const PAGE_PURGE_GROUPS = 10;

export async function purgeWorkspacePages(ctx: RequestContext, before: Date, windowDays: number): Promise<{ pages: number; groups: number }> {
    const out = { pages: 0, groups: 0 };
    for (;;) {
        // guardrail-allow: n+1 — a batched drain: each pass is one bounded read and one delete, in its own transaction.
        const page = await inPageTreeQueue(ctx.tenantId, () =>
            runInTenantContext(ctx, async (db) => {
                await lockPageTree(db, ctx.tenantId);
                const groups = await PageRepository.purgeableGroups(db, ctx, before, PAGE_PURGE_GROUPS);
                const ids = await PageRepository.idsOfGroups(db, ctx, groups, PAGE_PURGE_GROUPS * PAGE_SUBTREE_CAP);
                const locked = await PageRepository.lockForWrite(db, ctx, ids);
                const deleted = await PageRepository.purge(db, ctx, locked, before);
                return { groups: groups.length, deleted };
            }),
        );
        out.groups += page.groups;
        out.pages += page.deleted;
        if (page.groups < PAGE_PURGE_GROUPS) break;
    }
    if (out.pages > 0) {
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'PAGES_PURGED',
                entityType: 'Tenant',
                entityId: ctx.tenantId,
                details: `Purged ${out.pages} page(s) deleted more than ${windowDays} days ago`,
                detailsJson: {
                    category: 'data_lifecycle',
                    operation: 'purged',
                    recordCount: out.pages,
                    model: 'Page',
                    reason: 'soft-delete window elapsed',
                    graceDays: windowDays,
                },
                metadata: { ...out, windowDays },
            }),
        );
    }
    return out;
}
