/**
 * A person's dashboards under concurrent creates (sub-phase 3.6d;
 * docs/porting/maps/3.6.md, "Rules no decision names (3.6d, as built)",
 * rule 5): a person keeps at most 50 dashboards (409 `DASHBOARD_LIMIT`).
 * The count ran in each create's own transaction with no lock of its own, so
 * several creates at 49 each counted 49 and all committed. Each create now
 * takes a transaction-scoped advisory lock on the workspace and the creator
 * first (`DashboardRepository.lockCreatesOf`), before the membership and the
 * count, so they count one after another.
 *
 * Each round puts a person at 49 dashboards and fires several creates at
 * once through the real usecase: exactly one succeeds, the rest are refused
 * with `DASHBOARD_LIMIT`, the person ends at 50, and nothing deadlocks.
 * Another person's creates at the same time are not held by the lock.
 */
import type { PrismaClient } from '@prisma/client';

import { createDashboard } from '@/app-layer/usecases/dashboard';
import { DASHBOARD_LIMIT, DASHBOARD_LIMITS } from '@/lib/analytics/dashboard';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { makeRequestContext } from '../../helpers/make-context';
import { roundNumbers, scaledTimeout } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `dshc${Date.now().toString(36)}`;
/** Creates fired at once per round. */
const AT_ONCE = 6;

describeFn("concurrency: a person's 50 dashboards under concurrent creates", () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    /** A fresh Member with 49 dashboards already. */
    async function personAt49() {
        seq += 1;
        const user = await prisma.user.create({ data: { email: `maker${seq}-${TAG}@example.test`, name: `Maker ${seq}` } });
        await prisma.tenantMembership.create({ data: { tenantId: ws.tenantId, userId: user.id, role: 'MEMBER' } });
        await prisma.dashboard.createMany({
            data: Array.from({ length: DASHBOARD_LIMITS.perPerson - 1 }, (_, i) => ({ tenantId: ws.tenantId, name: `Existing ${i}`, visibility: 'PERSONAL' as const, createdByUserId: user.id })),
        });
        return makeRequestContext('MEMBER', { tenantId: ws.tenantId, tenantSlug: TAG, userId: user.id, requestId: `${TAG}-${seq}` });
    }

    it.each(roundNumbers(3))(
        'round %i: at 49, exactly one of several creates at once succeeds and the person ends at 50',
        async () => {
            const ctx = await personAt49();
            const other = await personAt49();
            const outcomes = await Promise.allSettled([
                ...Array.from({ length: AT_ONCE }, (_, i) => createDashboard({ ...ctx, requestId: `${ctx.requestId}-${i}` }, { name: `Racing ${i}`, visibility: 'PERSONAL' })),
                // Another person's create, at the same moment: their own lock, their own 50th.
                createDashboard(other, { name: 'Elsewhere', visibility: 'PERSONAL' }),
            ]);
            const mine = outcomes.slice(0, AT_ONCE);
            expect(mine.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
            const refused = mine.filter((o): o is PromiseRejectedResult => o.status === 'rejected').map((o) => (o.reason as { code?: string }).code);
            expect(refused).toEqual(Array.from({ length: AT_ONCE - 1 }, () => DASHBOARD_LIMIT));
            expect(outcomes[AT_ONCE]!.status).toBe('fulfilled');
            expect(await prisma.dashboard.count({ where: { tenantId: ws.tenantId, createdByUserId: ctx.userId } })).toBe(DASHBOARD_LIMITS.perPerson);
            expect(await prisma.dashboard.count({ where: { tenantId: ws.tenantId, createdByUserId: other.userId } })).toBe(DASHBOARD_LIMITS.perPerson);
        },
        scaledTimeout(30_000),
    );
});
