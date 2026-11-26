/**
 * The one in-process write queue (owner decisions 174 and 254;
 * `src/app-layer/usecases/write-queue.ts`): first in, first out per key, at
 * most `concurrency` at once, re-entrant, a failure releasing its turn, and
 * the graph lock refused outside its workspace's turn.
 */
import { keyedWriteQueue } from '@/app-layer/usecases/write-queue';
import { lockWorkItemGraph } from '@/app-layer/usecases/work-item-graph-lock';
import { holdsWorkItemGraphTurn, inWorkItemGraphQueue, queuedGraphWorkspaceCount } from '@/app-layer/usecases/work-item-graph-queue';
import { inProjectSequenceQueue, queuedProjectCount } from '@/app-layer/usecases/project-sequence-queue';

function gate() {
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { opened, open };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('keyedWriteQueue', () => {
    it('runs one write per key at a time, first in first out, and other keys alongside', async () => {
        const queue = keyedWriteQueue({ concurrency: 1 });
        const order: string[] = [];
        const first = gate();
        const a1 = queue.run('a', async () => {
            order.push('a1 start');
            await first.opened;
            order.push('a1 end');
        });
        const a2 = queue.run('a', async () => {
            order.push('a2');
        });
        const b1 = queue.run('b', async () => {
            order.push('b1');
        });
        await tick();
        expect(order).toEqual(['a1 start', 'b1']);
        expect(queue.size()).toBe(1);
        first.open();
        await Promise.all([a1, a2, b1]);
        expect(order).toEqual(['a1 start', 'b1', 'a1 end', 'a2']);
        expect(queue.size()).toBe(0);
    });

    it('never runs more than its concurrency under one key, and a burst over it waits rather than failing', async () => {
        const queue = keyedWriteQueue({ concurrency: 3 });
        let running = 0;
        let peak = 0;
        const writes = Array.from({ length: 25 }, (_, i) =>
            queue.run('k', async () => {
                running += 1;
                peak = Math.max(peak, running);
                await tick();
                running -= 1;
                return i;
            }),
        );
        expect(await Promise.all(writes)).toEqual(Array.from({ length: 25 }, (_, i) => i));
        expect(peak).toBe(3);
        expect(queue.size()).toBe(0);
    });

    it('lets a write that already holds the key run again at once (it never waits on itself)', async () => {
        const queue = keyedWriteQueue({ concurrency: 1 });
        const result = await queue.run('k', async () => {
            expect(queue.holds('k')).toBe(true);
            return queue.run('k', async () => 'nested');
        });
        expect(result).toBe('nested');
        expect(queue.holds('k')).toBe(false);
    });

    it('releases the turn when a write fails', async () => {
        const queue = keyedWriteQueue({ concurrency: 1 });
        await expect(queue.run('k', async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');
        expect(await queue.run('k', async () => 'next')).toBe('next');
        expect(queue.size()).toBe(0);
    });

    it('refuses a concurrency below one', () => {
        expect(() => keyedWriteQueue({ concurrency: 0 })).toThrow();
    });
});

describe('the graph queue and the project queue', () => {
    it('nest graph first, then project, and a graph write and a project write of another kind do not wait on each other', async () => {
        const held = gate();
        const order: string[] = [];
        const nested = inWorkItemGraphQueue('t1', () =>
            inProjectSequenceQueue('t1', 'p1', async () => {
                order.push('nested');
                await held.opened;
            }),
        );
        await tick();
        // A plain create in another project runs while the graph turn is held.
        await inProjectSequenceQueue('t1', 'p2', async () => {
            order.push('other project');
        });
        expect(order).toEqual(['nested', 'other project']);
        expect(queuedGraphWorkspaceCount()).toBe(1);
        held.open();
        await nested;
        expect(queuedGraphWorkspaceCount()).toBe(0);
        expect(queuedProjectCount()).toBe(0);
    });

    it('lockWorkItemGraph refuses to run outside its workspace\'s turn, and runs inside it', async () => {
        const db = { $executeRawUnsafe: jest.fn(async () => 0) };
        await expect(lockWorkItemGraph(db, 't1')).rejects.toThrow(/inWorkItemGraphQueue/);
        await expect(inWorkItemGraphQueue('t2', () => lockWorkItemGraph(db, 't1'))).rejects.toThrow(/inWorkItemGraphQueue/);
        expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
        await inWorkItemGraphQueue('t1', async () => {
            expect(holdsWorkItemGraphTurn('t1')).toBe(true);
            await lockWorkItemGraph(db, 't1');
        });
        expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    });
});
