/**
 * Writes that take a workspace's graph lock wait their turn in this process,
 * per workspace, before they open a transaction (owner decision 254,
 * 2026-11-26, on the pattern of decision 174; Hardening H2, issue #70).
 *
 * The graph lock (`lockWorkItemGraph`, `work-item-graph-lock.ts`) is taken
 * FIRST in every transaction that writes `parentId` or a relation: a move to
 * another project, a re-parent, adding or removing a relation, a create with
 * a parent or a template, the bulk reschedule. The database runs those one
 * at a time per workspace, and each waiter used to hold a pooled connection
 * while it waited, so a burst emptied the pool as creates had. Here they
 * wait without a connection, `WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE` at a time.
 *
 * Nesting follows the locks' order: the graph queue first, then a project's
 * sequence queue (`inProjectSequenceQueue`), as a transaction takes the graph
 * lock before the sequence row. A write already in its workspace's turn that
 * reaches the queue again runs at once (`write-queue.ts` is re-entrant), and
 * `lockWorkItemGraph` refuses to run outside its workspace's turn, so a new
 * graph write cannot forget the queue.
 */
import { WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE } from '@/lib/db/concurrency-limits';

import { keyedWriteQueue } from './write-queue';

const queue = keyedWriteQueue({ concurrency: WORK_ITEM_GRAPH_WRITES_PER_WORKSPACE });

/** Run `fn` at its turn among the workspace's graph writes in this process. */
export async function inWorkItemGraphQueue<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return queue.run(tenantId, fn);
}

/** Whether the current async context runs in the workspace's graph turn. */
export function holdsWorkItemGraphTurn(tenantId: string): boolean {
    return queue.holds(tenantId);
}

/** How many workspaces have a graph write running or waiting (for tests). */
export function queuedGraphWorkspaceCount(): number {
    return queue.size();
}
