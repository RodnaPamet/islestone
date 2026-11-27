/**
 * The per-workspace lock and queue every write to a page tree takes
 * (sub-phase 4.1a; docs/porting/maps/4.1.md, "Page and the tree"; ADR 0015
 * §1; owner decision 341).
 *
 * Every write that changes `Page.parentId`, `projectId` or `sortKey` (a
 * create, a move, a reorder), every delete and restore and every purge page
 * takes `pg_advisory_xact_lock(hashtext('page-tree:' || tenantId))` FIRST,
 * then the page rows it changes in id order (decision 173), so the cycle,
 * depth and placement checks that follow read the committed result of
 * whichever write held the lock before. One lock serves both kinds of tree:
 * a move between trees changes both.
 *
 * Before its transaction, a tree write waits its workspace's turn in the
 * process (`inPageTreeQueue`, the one queue implementation of decision 254),
 * so a burst of moves does not hold PgBouncer's connections while it waits;
 * `lockPageTree` throws outside it.
 *
 * The key is namespaced so it never collides with the audit chain's bare
 * `hashtext(tenantId)`, the owner locks, the goal tree or the work-item graph.
 */
import type { Prisma } from '@prisma/client';

import { PAGE_TREE_WRITES_PER_WORKSPACE } from '@/lib/db/concurrency-limits';

import { keyedWriteQueue } from './write-queue';

const queue = keyedWriteQueue({ concurrency: PAGE_TREE_WRITES_PER_WORKSPACE });

/** Run `fn` at its workspace's turn among page-tree writes (re-entrant). */
export async function inPageTreeQueue<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return queue.run(tenantId, fn);
}

export function holdsPageTreeTurn(tenantId: string): boolean {
    return queue.holds(tenantId);
}

export function pageTreeLockKey(tenantId: string): string {
    return `page-tree:${tenantId}`;
}

export async function lockPageTree(db: Pick<Prisma.TransactionClient, '$executeRawUnsafe'>, tenantId: string): Promise<void> {
    if (!holdsPageTreeTurn(tenantId)) {
        throw new Error('lockPageTree runs only inside inPageTreeQueue for its workspace (decision 254).');
    }
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, pageTreeLockKey(tenantId));
}
