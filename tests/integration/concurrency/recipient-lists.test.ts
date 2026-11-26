/**
 * Recipient-list changes racing a member's removal (Hardening H2, part 2;
 * issue #70; the map's row "recipient list resolution versus member
 * removal").
 *
 * A list's people (`RecipientListMember`) and an item's watchers
 * (`WorkItemWatcher`) carry a cascading foreign key to the membership, and
 * each write checked "an ACTIVE member" with a plain read. A removal that
 * deleted the membership between that read and the insert made the insert's
 * foreign-key check fail when the removal committed: an untyped error (P2003,
 * a 500 to the caller) instead of the change's own refusal or a clean skip.
 * Shown before the fix by the two deterministic tests: another transaction
 * holds the membership row, as the removal does once it deletes it, the
 * write starts and is seen waiting on a lock, then the row is deleted and
 * committed.
 *
 * The fix reads the people's memberships `FOR KEY SHARE`
 * (`MembershipRepository.lockActiveUserIds`), so a removal in flight is
 * waited for and then seen; adding a list as watchers locks the item first,
 * in the removal's own order (item rows, then the membership). The last test
 * runs the real usecases against each other, the removal's items locked
 * first, and holds the end state: no list entry or watcher row for a person
 * who is not a member, never a deadlock, every refusal typed.
 */
import type { PrismaClient } from '@prisma/client';

import { addRecipientListAsWatchers, changeRecipientListMembers, createRecipientList } from '@/app-layer/usecases/recipient-list';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { createWorkItem } from '@/app-layer/usecases/work-item';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rlst${Date.now().toString(36)}`;

describeFn('concurrency: recipient lists against a member\'s removal', () => {
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

    async function leaver() {
        seq += 1;
        const user = await prisma.user.create({ data: { email: `leaver${seq}-${TAG}@example.test`, name: `Leaver ${seq}` } });
        const membership = await prisma.tenantMembership.create({ data: { tenantId: ws.tenantId, userId: user.id, role: 'MEMBER' } });
        return { userId: user.id, membershipId: membership.id };
    }

    /**
     * Wait until another session of this database waits on a row lock, by
     * observation rather than by the clock, so a slow machine only waits
     * longer. Fails after `limitMs` without one.
     */
    async function untilSomeoneWaitsOnALock(limitMs = 20_000) {
        const start = Date.now();
        for (;;) {
            const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
                SELECT count(*) AS n FROM pg_stat_activity
                 WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
            if (Number(row!.n) > 0) return;
            if (Date.now() - start > limitMs) throw new Error('no session waited on a lock');
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    /**
     * Hold the membership row as a removal does once it deletes it, start
     * `write`, wait until it waits on a lock, then delete the row and commit.
     */
    async function removedWhile<T>(membershipId: string, write: () => Promise<T>): Promise<PromiseSettledResult<T>> {
        let pending: Promise<T> | undefined;
        await prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "TenantMembership" WHERE "id" = ${membershipId} FOR UPDATE`;
                pending = write();
                // An unhandled rejection before the await below would fail the run.
                pending.catch(() => undefined);
                await untilSomeoneWaitsOnALock();
                await tx.$executeRaw`DELETE FROM "TenantMembership" WHERE "id" = ${membershipId}`;
            },
            { timeout: 30_000, maxWait: 10_000 },
        );
        const [settled] = await Promise.allSettled([pending!]);
        return settled!;
    }

    const isTyped = (reason: unknown) => typeof (reason as { status?: unknown }).status === 'number' && (reason as { status: number }).status < 500;

    it('adding a person to a list while their membership is being deleted: the change is refused as such, nothing stored', async () => {
        const lee = await leaver();
        const list = await createRecipientList(ws.owner, null, { name: `Escalation ${seq}`, userIds: [ws.owner.userId] });
        const settled = await removedWhile(lee.membershipId, () =>
            changeRecipientListMembers(ws.owner, null, list.id, { add: [lee.userId, ws.memberUserId] }),
        );
        expect(settled.status).toBe('rejected');
        const reason = (settled as PromiseRejectedResult).reason;
        expect(String(reason)).not.toMatch(/P2003|foreign key/i);
        expect(reason).toMatchObject({ status: 400 });
        const rows = await prisma.recipientListMember.findMany({ where: { listId: list.id }, select: { userId: true } });
        expect(rows.map((r) => r.userId)).toEqual([ws.owner.userId]);
    });

    it('adding a list as watchers while one of its people is being removed: that person is skipped, the rest watch', async () => {
        const lee = await leaver();
        const list = await createRecipientList(ws.owner, null, { name: `Watchers ${seq}`, userIds: [lee.userId, ws.memberUserId] });
        const item = await createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title: `watched ${seq}` });
        const settled = await removedWhile(lee.membershipId, () => addRecipientListAsWatchers(ws.owner, item.id, list.id));
        expect(settled.status === 'rejected' ? String((settled as PromiseRejectedResult).reason) : 'fulfilled').toBe('fulfilled');
        const result = (settled as PromiseFulfilledResult<Awaited<ReturnType<typeof addRecipientListAsWatchers>>>).value;
        expect(result.added).toEqual([ws.memberUserId]);
        const watchers = await prisma.workItemWatcher.findMany({ where: { workItemId: item.id }, select: { userId: true } });
        expect(watchers.map((w) => w.userId)).toEqual([ws.memberUserId]);
    });

    it('list changes and watchers from a list racing the real removal: never a deadlock, never a non-member on a list or watching', async () => {
        for (let round = 0; round < 4; round++) {
            const lee = await leaver();
            const list = await createRecipientList(ws.owner, null, { name: `Race ${round}`, userIds: [lee.userId] });
            const other = await createRecipientList(ws.owner, null, { name: `Race other ${round}`, userIds: [ws.owner.userId] });
            // Items assigned to the leaver: the removal locks them first, then deletes the membership.
            const items = [];
            for (let i = 0; i < 4; i++) {
                // guardrail-allow: n+1 — the test's own setup.
                items.push(await createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title: `race ${round}-${i}`, assigneeId: lee.userId }));
            }
            const settled = await Promise.allSettled([
                ...items.map((it) => addRecipientListAsWatchers(ws.owner, it.id, list.id)),
                changeRecipientListMembers(ws.owner, null, other.id, { add: [lee.userId] }),
                removeTenantMember(ws.owner, { membershipId: lee.membershipId }),
                ...items.slice(0, 2).map((it) => addRecipientListAsWatchers(ws.member, it.id, list.id)),
            ]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock).map(String)).toEqual([]);
            expect(failures.filter((f) => !isTyped(f)).map(String)).toEqual([]);
            // The removal itself always succeeds.
            const removal = settled[items.length + 1]!;
            expect(removal.status === 'rejected' ? String((removal as PromiseRejectedResult).reason) : 'fulfilled').toBe('fulfilled');

            expect(await prisma.tenantMembership.count({ where: { id: lee.membershipId } })).toBe(0);
            expect(await prisma.recipientListMember.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
            expect(await prisma.workItemWatcher.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
            expect(await prisma.workItem.count({ where: { tenantId: ws.tenantId, assigneeId: lee.userId } })).toBe(0);
        }
    });
});
