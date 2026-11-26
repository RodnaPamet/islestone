/**
 * The goal purge for one workspace (sub-phase 3.2a; owner decision 219):
 * hard-delete the goals and initiatives soft-deleted more than
 * `GOAL_PURGE_DAYS` (30) ago. Run by the nightly `goal-purge` job as the
 * workspace's system user.
 *
 *   - Bounded pages in id order, each in a transaction of its own:
 *     initiatives first, then goals.
 *   - The database clears every link to a purged row through the four
 *     column-scoped `ON DELETE SET NULL` keys: a project loses its
 *     initiative, an initiative its goal, a goal its parent, an item its goal.
 *     The page's items are locked in id order first (decision 173) and
 *     counted, and so are the projects; the unlink writes no item audit
 *     entry, bumps no version and fires no transition (the trigger does not
 *     watch `goalId`).
 *   - One counts-only `GOALS_PURGED` entry per workspace (goals,
 *     initiatives, projects unlinked, items unlinked), never a title.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { GoalRepository } from '../repositories/GoalRepository';
import { InitiativeRepository } from '../repositories/InitiativeRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { lockGoalTree } from './goal-tree-lock';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';

export const GOAL_PURGE_BATCH = 200;

export interface GoalPurgeOutcome {
    goals: number;
    initiatives: number;
    projectsUnlinked: number;
    itemsUnlinked: number;
}

export async function purgeWorkspaceGoals(ctx: RequestContext, before: Date, windowDays: number): Promise<GoalPurgeOutcome> {
    const out: GoalPurgeOutcome = { goals: 0, initiatives: 0, projectsUnlinked: 0, itemsUnlinked: 0 };
    for (;;) {
        // guardrail-allow: n+1 — a batched drain: each pass is one bounded read and one delete, in its own transaction.
        const page = await runInTenantContext(ctx, async (db) => {
            // The tree lock first, as every goal delete and restore takes it.
            await lockGoalTree(db, ctx.tenantId);
            const ids = await InitiativeRepository.purgeableIds(db, ctx, before, GOAL_PURGE_BATCH);
            const projects = await ProjectRepository.countNamingInitiatives(db, ctx, ids);
            const deleted = await InitiativeRepository.purgeBatch(db, ctx, ids, before);
            return { read: ids.length, deleted, projects };
        });
        out.initiatives += page.deleted;
        out.projectsUnlinked += page.projects;
        if (page.read < GOAL_PURGE_BATCH) break;
    }
    for (;;) {
        // guardrail-allow: n+1 — a batched drain: each pass is one bounded read and one delete, in its own transaction.
        const page = await runInTenantContext(ctx, async (db) => {
            await lockGoalTree(db, ctx.tenantId);
            const ids = await GoalRepository.purgeableIds(db, ctx, before, GOAL_PURGE_BATCH);
            // The items the delete unlinks, locked in id order before it (decision 173).
            const items = await WorkItemRepository.lockItemsNamingGoals(db, ctx, ids);
            const deleted = await GoalRepository.purgeBatch(db, ctx, ids, before);
            return { read: ids.length, deleted, items: items.length };
        });
        out.goals += page.deleted;
        out.itemsUnlinked += page.items;
        if (page.read < GOAL_PURGE_BATCH) break;
    }
    if (out.goals > 0 || out.initiatives > 0) {
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'GOALS_PURGED',
                entityType: 'Tenant',
                entityId: ctx.tenantId,
                details: `Purged ${out.goals} goal(s) and ${out.initiatives} initiative(s) deleted more than ${windowDays} days ago`,
                detailsJson: {
                    category: 'data_lifecycle',
                    operation: 'purged',
                    recordCount: out.goals + out.initiatives,
                    model: 'Goal',
                    reason: 'soft-delete window elapsed',
                    graceDays: windowDays,
                },
                metadata: { ...out, windowDays },
            }),
        );
    }
    return out;
}
