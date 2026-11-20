/**
 * Proof that a transaction holds work-item rows locked, taken in id order
 * (owner decision 173, 2026-11-20; Hardening H2's concurrency part; issue #65).
 *
 * Every write that touches more than one work item locks all of its items
 * FIRST, with one `SELECT … FOR UPDATE … ORDER BY "id"`, and only then reads
 * and plans from the locked rows. Two writers that overlap then queue on the
 * lowest shared id instead of each holding a row the other wants (a `40P01`
 * deadlock), and a plan never reads a row another transaction is about to
 * change (the stale "from" state an audit entry used to record).
 *
 * The rule is held by the type system: every `WorkItemRepository` (and
 * `TeamRepository`) method that can write more than one `WorkItem` row takes
 * a `LockedWorkItemIds`, and the only producers of one are the lock methods
 * of `WorkItemRepository` (through {@link mintLockedWorkItemIds}) and
 * {@link lockedSubset}, which narrows a set already locked.
 * `tests/guards/work-item-multi-row-lock.test.ts` holds the rest: no cast to
 * the brand outside this file, no multi-row `WorkItem` write without it, and
 * no single-row writer called in a loop.
 *
 * The order of every path that takes more than one kind of lock is fixed:
 * the workspace's graph lock (`lockWorkItemGraph`, an advisory lock), then
 * the projects' key-sequence rows (`ProjectRepository.lockSequences`, in
 * project-id order), then the work-item rows (in id order, one statement).
 * A path never takes a lock earlier in that list after one later in it.
 */

declare const lockedWorkItemIds: unique symbol;

/** Ids of work-item rows this transaction holds `FOR UPDATE`, locked in id order. */
export type LockedWorkItemIds = readonly string[] & { readonly [lockedWorkItemIds]: true };

/**
 * Brand the ids a lock statement returned. Only `WorkItemRepository`'s lock
 * methods call it, with the ids of the rows their `FOR UPDATE` read returned.
 */
export function mintLockedWorkItemIds(ids: readonly string[]): LockedWorkItemIds {
    return ids as LockedWorkItemIds;
}

/** The locked ids that are also in `ids` (or satisfy `keep`): still locked. */
export function lockedSubset(locked: LockedWorkItemIds, keep: readonly string[] | ((id: string) => boolean)): LockedWorkItemIds {
    const test = typeof keep === 'function' ? keep : ((set) => (id: string) => set.has(id))(new Set(keep));
    return locked.filter(test) as unknown as LockedWorkItemIds;
}

/** Whether `id` is one of the locked rows (a single-row write inside a locked set asks it). */
export function isLocked(locked: LockedWorkItemIds, id: string): boolean {
    return locked.includes(id);
}
