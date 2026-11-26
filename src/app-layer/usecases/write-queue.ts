/**
 * The one in-process write queue (owner decisions 174 and 254; Hardening H2,
 * issues #32 and #70). Writes that serialise on one database lock wait their
 * turn here, keyed by what they lock, before they open their transaction, so
 * a waiter holds no pooled connection.
 *
 * Why it exists: a transaction that waits on a row or advisory lock holds a
 * pooled connection the whole time, and the writer at the head of such a
 * queue needs a second one for its audit append (`logEvent` appends on its
 * own connection, `src/lib/db/concurrency-limits.ts`). With enough waiters
 * PgBouncer's 20 server connections are all held by waiters, the head waits
 * for one, and every transaction expires. Measured three times: 24 of 25
 * simultaneous creates in a project (decision 174), every one of 200 public
 * submits (H2f), 31 of 35 intake accepts (issue #70).
 *
 * Its users, each a module of its own that names its key and its concurrency:
 * `project-sequence-queue.ts` (a project's key-sequence row), `work-item-graph-queue.ts`
 * (a workspace's graph lock) and `intake-write-queue.ts` (intake's rows).
 *
 *   - **First in, first out** per key; at most `concurrency` writes run at
 *     once under one key, the rest wait without a connection. A burst over
 *     the bound waits; nothing here refuses.
 *   - **Re-entrant.** A write already running under a key (in this async
 *     context) that reaches the same queue and key again runs at once: a
 *     queued usecase calling another never waits on itself. Different queues
 *     nest in the order their locks are taken (the graph queue, then a
 *     project's sequence queue), as the transactions take the locks.
 *   - **Per process.** The deployment runs one app container (decision 50);
 *     the database lock stays the guarantee across processes, and what a
 *     second process would lose is the bound on held connections
 *     (`docs/work-items.md`, "Writes that touch several items").
 *
 * Written fresh for Islestone.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface KeyedWriteQueue {
    /** Run `fn` at its turn under `key` (at once when this context already runs under it). */
    run<T>(key: string, fn: () => Promise<T>): Promise<T>;
    /** Whether the current async context runs under `key` in this queue. */
    holds(key: string): boolean;
    /** How many keys have a write running or waiting (for tests). */
    size(): number;
}

interface KeyState {
    running: number;
    waiters: Array<() => void>;
}

export function keyedWriteQueue(options: { concurrency: number }): KeyedWriteQueue {
    const { concurrency } = options;
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('A write queue runs at least one write per key.');
    const states = new Map<string, KeyState>();
    const held = new AsyncLocalStorage<ReadonlySet<string>>();

    const holds = (key: string) => held.getStore()?.has(key) === true;

    async function acquire(key: string): Promise<void> {
        let state = states.get(key);
        if (!state) {
            state = { running: 0, waiters: [] };
            states.set(key, state);
        }
        if (state.running < concurrency) {
            state.running += 1;
            return;
        }
        // The releasing write hands its slot over (running stays counted).
        await new Promise<void>((resolve) => state.waiters.push(resolve));
    }

    function release(key: string): void {
        const state = states.get(key);
        if (!state) return;
        const next = state.waiters.shift();
        if (next) {
            next();
            return;
        }
        state.running -= 1;
        if (state.running === 0) states.delete(key);
    }

    return {
        async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
            if (holds(key)) return fn();
            await acquire(key);
            try {
                const outer = held.getStore();
                return await held.run(new Set([...(outer ?? []), key]), fn);
            } finally {
                release(key);
            }
        },
        holds,
        size: () => states.size,
    };
}
