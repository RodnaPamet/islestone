/**
 * Writes that take a project's key-sequence row wait their turn in this
 * process before they open a transaction (owner decision 174, 2026-11-20;
 * Hardening H2; issue #32): creates, reorders and a board drop that places
 * the item.
 *
 * A create claims its number from the project's `ProjectKeySequence` row,
 * and a placement computes its `sortKey` under the same row's lock, held
 * until commit: numbers are gapless and a failed create uses none (ADR 0002
 * §4), and two placements in one gap must not pick the same key, so these
 * writes in one project are serial whatever this module does. What it
 * changes is WHERE they wait. Without it each waiter holds a pooled
 * connection inside an open transaction while it waits on the row lock, and
 * the writer at the head of the queue needs a second connection for its
 * audit append (`logEvent` appends on its own connection,
 * `src/lib/db/concurrency-limits.ts`). With enough waiters the pool is
 * empty: the head waits for a connection, every waiter's transaction
 * expires at `TENANT_TX_TIMEOUT_MS`, and 24 of 25 simultaneous creates
 * failed in the measurement that motivated this (a create alone took 30 to
 * 70 ms); 20 parallel reorders into one gap failed the same way on a CI
 * runner. A longer transaction limit would not help: nothing frees a
 * connection until a waiter gives up.
 *
 * So these writes queue here, keyed by workspace and project, and open their
 * transaction only at their turn: a waiter holds no connection. A placement
 * reads the item's project first, outside the queue; if a move changes it in
 * between, the row lock inside the transaction still serialises the write,
 * the queue only no longer spares it the wait. The queue is per process (the
 * deployment runs one app container; the worker's repeat job creates one
 * item at a time), and the row lock stays the guarantee across processes.
 * `WORK_ITEM_CREATE_BURST_PER_PROJECT` is the burst the integration suite
 * proves.
 */

/** The tail of each project's queue: resolves when the last write in it finishes. */
const tails = new Map<string, Promise<void>>();

/** Run `fn` once every write queued before it in the same project has finished. */
export async function inProjectSequenceQueue<T>(tenantId: string, projectId: string, fn: () => Promise<T>): Promise<T> {
    const key = `${tenantId}:${projectId}`;
    const prior = tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = prior.then(() => mine);
    tails.set(key, tail);
    await prior;
    try {
        return await fn();
    } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
    }
}

/** How many projects have a write running or waiting (for tests). */
export function queuedProjectCount(): number {
    return tails.size;
}
