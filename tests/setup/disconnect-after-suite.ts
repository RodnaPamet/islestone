/**
 * Global `afterAll` hook for the `integration` project — release long-lived
 * Prisma connections at the end of every test file.
 *
 * Two singletons need to come down:
 *   1. `prismaTestClient()` from `tests/helpers/db.ts` — the
 *      integration-test client.
 *   2. `prisma` (and `prismaRead`) from `src/lib/prisma.ts` — the app-layer
 *      singletons. Any test that goes through `runInTenantContext` reaches
 *      them, and each holds a Postgres pool open until disconnected.
 *
 * Both calls are no-ops when the underlying client was never materialised.
 * Sub-phases 1.5 and 1.6 add the Redis and queue drains here.
 */
import { disconnectTestClient } from '../helpers/db';

afterAll(async () => {
    await disconnectTestClient();
    // Reach for app-layer singletons only if they're already loaded —
    // don't force a fresh import and thereby create a new connection
    // just to close it.
    type Singletons = typeof globalThis & {
        prisma?: { $disconnect?: () => Promise<void> };
        prismaRead?: { $disconnect?: () => Promise<void> };
    };
    const g = globalThis as Singletons;
    for (const client of [g.prisma, g.prismaRead]) {
        if (client && typeof client.$disconnect === 'function') {
            try {
                await client.$disconnect();
            } catch {
                // Best effort — a leaked mid-query disconnect should not
                // surface as a suite failure.
            }
        }
    }
});
