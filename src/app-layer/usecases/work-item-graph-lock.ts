/**
 * The per-workspace lock every write to the blocking graph or to `parentId`
 * queues on (ADR 0002 §6).
 *
 * Two concurrent inserts can each pass the cycle check and together close a
 * cycle under READ COMMITTED; two re-parents can each pass the depth or
 * descendant check and together break it. So every such write first takes a
 * transaction-level advisory lock on `work-item-graph:<tenantId>`, and the
 * check that follows reads the committed result of whichever write held the
 * lock before.
 *
 * Take it FIRST in the transaction, before any row read or row lock: a
 * relation write and a re-parent that take row locks in different orders and
 * this lock in between can deadlock. The key is namespaced so it never
 * collides with the audit chain's bare `hashtext(tenantId)` or the owner
 * locks. Graph writes are rare, so one lock per workspace is acceptable; a
 * large import batches its graph writes.
 *
 * Copied from inflect-compliance `src/app-layer/usecases/tenant-owner-lock.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: same
 * `pg_advisory_xact_lock(hashtext($1))`, the key and the docblock rewritten
 * for the work-item graph.
 *
 * Islestone's addition (owner decision 254): the lock is taken only inside the
 * workspace's turn in the in-process graph queue (`inWorkItemGraphQueue`,
 * `work-item-graph-queue.ts`), so a waiting graph write holds no pooled
 * connection; a caller outside its turn is a programming error and throws.
 */
import type { Prisma } from '@prisma/client';

import { holdsWorkItemGraphTurn } from './work-item-graph-queue';

export function workItemGraphLockKey(tenantId: string): string {
    return `work-item-graph:${tenantId}`;
}

export async function lockWorkItemGraph(
    db: Pick<Prisma.TransactionClient, '$executeRawUnsafe'>,
    tenantId: string,
): Promise<void> {
    if (!holdsWorkItemGraphTurn(tenantId)) {
        throw new Error('lockWorkItemGraph runs only inside inWorkItemGraphQueue for its workspace (decision 254).');
    }
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, workItemGraphLockKey(tenantId));
}
