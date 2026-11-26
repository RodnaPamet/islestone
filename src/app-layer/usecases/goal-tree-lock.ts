/**
 * The per-workspace lock every write to the goal tree queues on (sub-phase
 * 3.2a; docs/porting/maps/3.2.md, "The tree rules"; ADR 0002 §2).
 *
 * Every write that changes `Goal.parentId` or `Initiative.goalId`, and every
 * goal delete and restore, takes `pg_advisory_xact_lock(hashtext('goal-tree:'
 * || tenantId))` first, so the cycle and depth checks that follow read the
 * committed result of whichever write held the lock before (two re-parents
 * could otherwise each pass the check and together break it, under READ
 * COMMITTED). A write that also touches projects or items takes it before any
 * project or item row (decision 173's order: graph locks, then sequence rows,
 * then item rows). Setting an item's goal does not take it: it changes no tree
 * link, and the goal is read `FOR KEY SHARE`.
 *
 * Same shape as `work-item-graph-lock.ts` (itself inflect-compliance's
 * `tenant-owner-lock.ts`); the key is namespaced so it never collides with the
 * audit chain's bare `hashtext(tenantId)`, the owner locks or the work-item
 * graph lock.
 */
import type { Prisma } from '@prisma/client';

export function goalTreeLockKey(tenantId: string): string {
    return `goal-tree:${tenantId}`;
}

export async function lockGoalTree(db: Pick<Prisma.TransactionClient, '$executeRawUnsafe'>, tenantId: string): Promise<void> {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, goalTreeLockKey(tenantId));
}
