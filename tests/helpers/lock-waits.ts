/**
 * Waiting on another session's lock by observation, never by the clock
 * (the concurrency suites of Hardening H2: issues #109 and #113).
 */
import type { PrismaClient } from '@prisma/client';

/** How many other sessions of this database wait on a lock now. */
export async function sessionsWaitingOnLocks(prisma: PrismaClient): Promise<number> {
    const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return Number(row!.n);
}

/**
 * Wait until at least `atLeast` other sessions of this database wait on a
 * lock, so a slow machine only waits longer. Fails after `limitMs` without.
 */
export async function untilSessionsWaitOnLocks(prisma: PrismaClient, atLeast = 1, limitMs = 20_000): Promise<void> {
    const start = Date.now();
    for (;;) {
        if ((await sessionsWaitingOnLocks(prisma)) >= atLeast) return;
        if (Date.now() - start > limitMs) throw new Error(`fewer than ${atLeast} session(s) waited on a lock`);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}
