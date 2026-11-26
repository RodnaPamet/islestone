/**
 * Intake writes that serialise on one row wait their turn in this process
 * before they open a transaction (Hardening H2f; the pattern of owner
 * decision 174, on the one in-process queue, `write-queue.ts`).
 *
 * A public submit counts a form's and its workspace's daily caps under the
 * form's row lock, and an inbound webhook counts an address's throttles under
 * its project intake row's lock, so either kind of write is serial in its key
 * whatever this module does. What it changes is where a waiter waits. Without
 * it each waiter holds a pooled connection inside an open transaction while
 * it waits on the row lock, and the writer at the head needs a second
 * connection for its audit append (`logEvent` appends on its own connection,
 * `src/lib/db/concurrency-limits.ts`): with enough waiters the pool is empty,
 * the head waits for a connection, and every transaction expires. H2f's
 * flood measured it: of 200 simultaneous public submits none was taken (all
 * 500, the transactions expired at five seconds), and 93 of 100 simultaneous
 * webhook deliveries of one email failed the same way.
 *
 * So these writes queue here and open their transaction at their turn,
 * holding no connection while they wait. The queue is per process (the
 * deployment runs one app container, which alone takes public submits and
 * webhooks); the row lock stays the guarantee across processes.
 */

import { keyedWriteQueue } from './write-queue';

/** One write at a time per key: the row lock serialises them anyway. */
const queue = keyedWriteQueue({ concurrency: 1 });

/** Run `fn` once every write queued before it under the same key has finished. */
export async function inIntakeWriteQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return queue.run(key, fn);
}

/** How many keys have a write running or waiting (for tests). */
export function queuedIntakeKeyCount(): number {
    return queue.size();
}
