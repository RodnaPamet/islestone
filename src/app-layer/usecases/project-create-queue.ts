/**
 * Creates in one project wait their turn in this process before they open a
 * transaction (owner decision 174, 2026-11-20; Hardening H2; issue #32).
 *
 * A create claims its number from the project's `ProjectKeySequence` row,
 * whose lock it holds until it commits: numbers are gapless and a failed
 * create uses none (ADR 0002 §4), so creates in one project are serial
 * whatever this module does. What it changes is WHERE they wait. Without it
 * each waiting create holds a pooled connection inside an open transaction
 * while it waits on the row lock, and the create at the head of the queue
 * needs a second connection for its audit append (`logEvent` appends on its
 * own connection, `src/lib/db/concurrency-limits.ts`). With
 * `DB_POOL_MAX` (25) waiters the pool is empty: the head waits for a
 * connection, every waiter's transaction expires at `TENANT_TX_TIMEOUT_MS`,
 * and 24 of 25 simultaneous creates failed in the measurement that motivated
 * this (a create alone took 30 to 70 ms). A longer transaction limit would
 * not help: nothing frees a connection until a waiter gives up.
 *
 * So `createWorkItem` queues here, keyed by workspace and project, and opens
 * its transaction only at its turn: a waiting create holds no connection.
 * The queue is per process (the deployment runs one app container; the
 * worker's repeat job creates one item at a time), and the row lock stays
 * the guarantee across processes. `WORK_ITEM_CREATE_BURST_PER_PROJECT` is the
 * burst the integration suite proves.
 */

/** The tail of each project's queue: resolves when the last create in it finishes. */
const tails = new Map<string, Promise<void>>();

/** Run `fn` once every create queued before it in the same project has finished. */
export async function inProjectCreateQueue<T>(tenantId: string, projectId: string, fn: () => Promise<T>): Promise<T> {
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

/** How many projects have a create running or waiting (for tests). */
export function queuedProjectCount(): number {
    return tails.size;
}
