/**
 * Writes that name a member, racing that member's removal (Hardening H2;
 * issue #109, the sites issue #70's recipient-list fix left).
 *
 * Each row below carries a cascading foreign key to the membership
 * (`WorkItemWatcher`, `Mention`, `IntakeNotifyMember`,
 * `WorkItemTypeReviewStepReviewer`, `NotificationPreference`; from 3.5a
 * `TimeOff` and `MemberCapacity`), and each write
 * checked "an ACTIVE member" with a plain read, or not at all, then inserted.
 * A removal that deleted the membership between the read and the insert made
 * the insert's foreign-key check fail when the removal committed: an untyped
 * error (P2003, a 500) instead of the write's own refusal or a clean skip.
 * Shown deterministically: another transaction plays the removal (in its own
 * order: the items it writes locked and unassigned, the membership deleted
 * last; or, with no item of the person involved, the membership row held as
 * the delete holds it), the write starts and is seen waiting on a lock in
 * `pg_stat_activity` (never timed), then the membership is deleted and
 * committed. Measured before the fix on 2026-11-26: every test failed with
 * the foreign-key error (the race of the real usecases on some runs, as its
 * timing allows) except the comment and description written on an item the
 * removal holds, whose write waited on the item and then read the membership
 * already gone; those two hold the lock order.
 *
 * The fix reads the people's memberships `FOR KEY SHARE`
 * (`MembershipRepository.lockActiveUserIds`) before the insert, after the
 * item, in the removal's own order (its items, then the membership). Editing
 * a comment held no lock on its item, so with the membership lock alone its
 * mention insert deadlocked against the removal (40P01, shown by the edit
 * test on a held item before `editComment` locked its item); it now locks
 * the item first.
 *
 * What the caller sees when the person is removed mid-flight, following
 * issue #70's choices: naming them in a list-like setting (a watcher added by
 * hand, the intake notify list, a type's default reviewers) is a 400, as
 * naming any non-member is; a person a write brings along (a mention and its
 * watcher, an intake requester, the creator of a question) is skipped, as if
 * the write had committed just before the removal and been cascaded; a
 * member's own preferences are refused 403, as their next request would be.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createIntakeForm } from '@/app-layer/usecases/intake-form';
import { acceptIntakeRequest, sendIntakeRequest } from '@/app-layer/usecases/intake-request';
import { setProjectIntake } from '@/app-layer/usecases/intake-settings';
import { updateMyNotificationPreferences } from '@/app-layer/usecases/notification-preferences';
import { setTypeReviewSteps } from '@/app-layer/usecases/review-defaults';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { createWorkItem, updateWorkItem } from '@/app-layer/usecases/work-item';
import { addComment, addWatcher, editComment, watchWorkItem } from '@/app-layer/usecases/work-item-collab';
import { addQuestionType } from '@/app-layer/usecases/work-item-type';
import { setTimeOffDays } from '@/app-layer/usecases/time-off';
import { setMemberCapacity } from '@/app-layer/usecases/workload-capacity';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { makeRequestContext } from '../../helpers/make-context';
import { rounds, scaledTimeout } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `mnwr${Date.now().toString(36)}`;

describeFn('concurrency: writes naming a member against that member\'s removal', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let formId = '';
    let questionTypeId = '';
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
        await setProjectIntake(ws.owner, ws.projectId, { enabled: true });
        formId = (await createIntakeForm(ws.owner, { projectId: ws.projectId, name: 'Requests', definition: { fields: [] } })).id;
        questionTypeId = (await addQuestionType(ws.owner)).id;
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    interface Leaver {
        userId: string;
        membershipId: string;
        ctx: RequestContext;
    }

    async function leaver(): Promise<Leaver> {
        seq += 1;
        const user = await prisma.user.create({ data: { email: `leaver${seq}-${TAG}@example.test`, name: `Leaver ${seq}` } });
        const membership = await prisma.tenantMembership.create({ data: { tenantId: ws.tenantId, userId: user.id, role: 'MEMBER' } });
        const ctx = makeRequestContext('MEMBER', { tenantId: ws.tenantId, userId: user.id, tenantSlug: TAG, requestId: `${TAG}-l${seq}` });
        return { userId: user.id, membershipId: membership.id, ctx };
    }

    /** An item assigned to the leaver, so the removal locks it before it deletes the membership. */
    async function itemOf(lee: Leaver, title: string) {
        return createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title, assigneeId: lee.userId });
    }

    /**
     * Wait until another session of this database waits on a lock, by
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
     * Play a member's removal around `write`, in the removal's own order.
     * With `itemIds` (the items the removal writes): lock them in id order
     * and unassign them, start `write`, wait until it waits on a lock, then
     * delete the membership and commit; the membership is not touched before
     * its delete, as `removeTenantMember` does not touch it, so a write that
     * locks the membership before the item meets the delete head-on. Without
     * items: hold the membership row as the delete does, start `write`, wait,
     * delete and commit. The removal's own failure (a deadlock the write's
     * order caused) is returned beside the write's outcome.
     */
    async function removalAround<T>(lee: Leaver, itemIds: readonly string[], write: () => Promise<T>) {
        let pending: Promise<T> | undefined;
        const removal = await prisma
            .$transaction(
                async (tx) => {
                    if (itemIds.length > 0) {
                        await tx.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ANY(${[...itemIds]}::text[]) ORDER BY "id" FOR UPDATE`;
                        // As the removal unassigns them before its delete (the assignee's key is RESTRICT).
                        await tx.$executeRaw`UPDATE "WorkItem" SET "assigneeId" = NULL WHERE "id" = ANY(${[...itemIds]}::text[])`;
                    } else {
                        await tx.$queryRaw`SELECT "id" FROM "TenantMembership" WHERE "id" = ${lee.membershipId} FOR UPDATE`;
                    }
                    pending = write();
                    // An unhandled rejection before the await below would fail the run.
                    pending.catch(() => undefined);
                    await untilSomeoneWaitsOnALock();
                    await tx.$executeRaw`DELETE FROM "TenantMembership" WHERE "id" = ${lee.membershipId}`;
                },
                { timeout: 30_000, maxWait: 10_000 },
            )
            .then(
                () => 'committed' as const,
                (err: unknown) => String(err),
            );
        const [settled] = await Promise.allSettled([pending!]);
        return { removal, write: settled! };
    }

    function fulfilled<T>(settled: PromiseSettledResult<T>): T {
        // On failure this prints the reason.
        expect(settled.status === 'rejected' ? String((settled as PromiseRejectedResult).reason) : 'fulfilled').toBe('fulfilled');
        return (settled as PromiseFulfilledResult<T>).value;
    }

    function refusedWith(settled: PromiseSettledResult<unknown>, status: number) {
        expect(settled.status).toBe('rejected');
        const reason = (settled as PromiseRejectedResult).reason;
        expect(String(reason)).not.toMatch(/P2003|foreign key/i);
        expect(reason).toMatchObject({ status });
    }

    const watchersOf = async (workItemId: string) =>
        (await prisma.workItemWatcher.findMany({ where: { workItemId }, select: { userId: true }, orderBy: { userId: 'asc' } })).map((w) => w.userId);
    const mentionsOf = async (workItemId: string) =>
        (await prisma.mention.findMany({ where: { workItemId }, select: { mentionedUserId: true }, orderBy: { mentionedUserId: 'asc' } })).map((m) => m.mentionedUserId);

    it('adding a watcher by hand while the person is being removed: a 400 naming a non-member, nothing stored', async () => {
        const lee = await leaver();
        const item = await itemOf(lee, `watch ${seq}`);
        const { removal, write } = await removalAround(lee, [item.id], () => addWatcher(ws.owner, item.id, lee.userId));
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        expect(await watchersOf(item.id)).not.toContain(lee.userId);
    });

    it('a member watching an item while being removed: the same 400, nothing stored', async () => {
        const lee = await leaver();
        const item = await itemOf(lee, `self watch ${seq}`);
        const { removal, write } = await removalAround(lee, [item.id], () => watchWorkItem(lee.ctx, item.id));
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        expect(await watchersOf(item.id)).not.toContain(lee.userId);
    });

    /**
     * The text writes, each twice: on an item the removal holds (assigned to
     * the person, so the removal locks it before its delete: the lock order),
     * and on one it does not (the bare foreign-key race).
     */
    async function textTarget(lee: Leaver, held: boolean, title: string) {
        const item = held ? await itemOf(lee, title) : await createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title });
        return { item, holds: held ? [item.id] : [] };
    }
    const HELD = [
        ['the removal holds the item', true],
        ['the removal does not hold the item', false],
    ] as const;

    it.each(HELD)('a comment mentioning the person being removed (%s): stored, the mention and its watcher skipped, the others kept', async (_label, held) => {
        const lee = await leaver();
        const { item, holds } = await textTarget(lee, held, `comment ${seq}`);
        const { removal, write } = await removalAround(lee, holds, () =>
            addComment(ws.owner, item.id, { body: `Over to <@${lee.userId}> and <@${ws.memberUserId}>` }),
        );
        expect(removal).toBe('committed');
        const comment = fulfilled(write);
        expect(comment.mentions).toEqual([ws.memberUserId]);
        expect(await mentionsOf(item.id)).toEqual([ws.memberUserId]);
        expect(await watchersOf(item.id)).toEqual([ws.memberUserId]);
    });

    it.each(HELD)('a comment edited to mention the person being removed (%s): no deadlock, the mention skipped', async (_label, held) => {
        const lee = await leaver();
        const { item, holds } = await textTarget(lee, held, `edit ${seq}`);
        const comment = await addComment(ws.owner, item.id, { body: 'First draft' });
        const { removal, write } = await removalAround(lee, holds, () =>
            editComment(ws.owner, item.id, comment.id, { body: `Now with <@${lee.userId}> and <@${ws.memberUserId}>` }),
        );
        expect(removal).toBe('committed');
        const edited = fulfilled(write) as { mentions?: string[] };
        expect(edited.mentions).toEqual([ws.memberUserId]);
        expect(await mentionsOf(item.id)).toEqual([ws.memberUserId]);
        expect(await watchersOf(item.id)).toEqual([ws.memberUserId]);
    });

    it.each(HELD)('a description edited to mention the person being removed (%s): saved, the mention skipped', async (_label, held) => {
        const lee = await leaver();
        const { item, holds } = await textTarget(lee, held, `description ${seq}`);
        const { removal, write } = await removalAround(lee, holds, () =>
            updateWorkItem(ws.owner, item.id, { description: `Ask <@${lee.userId}> or <@${ws.memberUserId}>` }, item.version),
        );
        expect(removal).toBe('committed');
        fulfilled(write);
        expect(await mentionsOf(item.id)).toEqual([ws.memberUserId]);
        expect(await watchersOf(item.id)).toEqual([ws.memberUserId]);
    });

    it('a new item whose description mentions the person being removed: created, the mention skipped', async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () =>
            createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title: `new ${seq}`, description: `For <@${lee.userId}> and <@${ws.memberUserId}>` }),
        );
        expect(removal).toBe('committed');
        const created = fulfilled(write);
        expect(await mentionsOf(created.id)).toEqual([ws.memberUserId]);
        expect(await watchersOf(created.id)).toEqual([ws.memberUserId]);
    });

    it('a question created by the person being removed: created, its creator not made a watcher', async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () =>
            createWorkItem(lee.ctx, {
                projectId: ws.projectId,
                typeId: questionTypeId,
                title: `question ${seq}`,
                dueDate: '2027-01-15',
                waitingOnUserId: ws.memberUserId,
            }),
        );
        expect(removal).toBe('committed');
        const created = fulfilled(write);
        expect(await watchersOf(created.id)).toEqual([]);
    });

    it('accepting a request whose requester is being removed: the item made, the requester not watching', async () => {
        const lee = await leaver();
        const request = await sendIntakeRequest(lee.ctx, formId, { title: `request ${seq}`, body: 'Please', answers: {} });
        const { removal, write } = await removalAround(lee, [], () => acceptIntakeRequest(ws.owner, request.id, { typeId: ws.typeId }, request.version));
        expect(removal).toBe('committed');
        fulfilled(write);
        const accepted = await prisma.intakeRequest.findUniqueOrThrow({ where: { id: request.id }, select: { status: true, workItemId: true } });
        expect(accepted.status).toBe('ACCEPTED');
        expect(await watchersOf(accepted.workItemId!)).toEqual([]);
    });

    it('naming the person being removed on the intake notify list: a 400, the list unchanged', async () => {
        const lee = await leaver();
        const before = await prisma.intakeNotifyMember.findMany({ where: { projectId: ws.projectId }, select: { userId: true } });
        const { removal, write } = await removalAround(lee, [], () =>
            setProjectIntake(ws.owner, ws.projectId, { enabled: true, notifyUserIds: [ws.memberUserId, lee.userId] }),
        );
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        const after = await prisma.intakeNotifyMember.findMany({ where: { projectId: ws.projectId }, select: { userId: true } });
        expect(after).toEqual(before);
    });

    it('naming the person being removed as a type\'s default reviewer: a 400, the defaults unchanged', async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () =>
            setTypeReviewSteps(ws.owner, ws.typeId, {
                reviewRequiredForDone: false,
                steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [ws.memberUserId, lee.userId], recipientListIds: [] }],
            }),
        );
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        expect(await prisma.workItemTypeReviewStepReviewer.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
    });

    it('a member changing their own preferences while being removed: a 403, nothing stored', async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () =>
            updateMyNotificationPreferences(lee.ctx, { rows: [{ type: 'WORK_ITEM_WATCH_UPDATE', inApp: false, email: 'OFF' }] }),
        );
        expect(removal).toBe('committed');
        refusedWith(write, 403);
        expect(await prisma.notificationPreference.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
    });

    // Sub-phase 3.5a: capacity and time off cascade with the membership; a manager naming the person being
    // removed is refused as naming any non-member, and nothing is stored.
    it("recording time off for the person being removed: a 400, nothing stored", async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () => setTimeOffDays(ws.owner, { userId: lee.userId, days: [{ day: '2051-05-05', minutes: null, type: 'SICK' }] }));
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        expect(await prisma.timeOff.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
    });

    it("setting the capacity of the person being removed: a 400, nothing stored", async () => {
        const lee = await leaver();
        const { removal, write } = await removalAround(lee, [], () => setMemberCapacity(ws.owner, lee.userId, { effectiveFrom: '2051-05-01', weeklyMinutes: 1200, calendarTeamId: null }));
        expect(removal).toBe('committed');
        refusedWith(write, 400);
        expect(await prisma.memberCapacity.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
    });

    it('watchers, comments and edits naming a member racing the real removal: never a deadlock, never a non-member watching or mentioned', async () => {
        const isTyped = (reason: unknown) => typeof (reason as { status?: unknown }).status === 'number' && (reason as { status: number }).status < 500;
        for (let round = 0; round < rounds(4); round++) {
            const lee = await leaver();
            const items = [];
            for (let i = 0; i < 4; i++) {
                // guardrail-allow: n+1 — the test's own setup.
                items.push(await itemOf(lee, `race ${round}-${i}`));
            }
            const comment = await addComment(ws.owner, items[3]!.id, { body: 'draft' });
            const mention = `<@${lee.userId}> <@${ws.memberUserId}>`;
            const settled = await Promise.allSettled([
                addWatcher(ws.owner, items[0]!.id, lee.userId),
                watchWorkItem(lee.ctx, items[1]!.id),
                addComment(ws.member, items[2]!.id, { body: `ping ${mention}` }),
                removeTenantMember(ws.owner, { membershipId: lee.membershipId }),
                editComment(ws.owner, items[3]!.id, comment.id, { body: `edited ${mention}` }),
                updateWorkItem(ws.owner, items[0]!.id, { description: `see ${mention}` }, items[0]!.version),
                addComment(ws.owner, items[1]!.id, { body: `and ${mention}` }),
            ]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock).map(String)).toEqual([]);
            expect(failures.filter((f) => !isTyped(f)).map(String)).toEqual([]);
            const removal = settled[3]!;
            expect(removal.status === 'rejected' ? String((removal as PromiseRejectedResult).reason) : 'fulfilled').toBe('fulfilled');

            expect(await prisma.tenantMembership.count({ where: { id: lee.membershipId } })).toBe(0);
            expect(await prisma.workItemWatcher.count({ where: { tenantId: ws.tenantId, userId: lee.userId } })).toBe(0);
            expect(await prisma.mention.count({ where: { tenantId: ws.tenantId, mentionedUserId: lee.userId } })).toBe(0);
            expect(await prisma.workItem.count({ where: { tenantId: ws.tenantId, assigneeId: lee.userId } })).toBe(0);
        }
    }, scaledTimeout());
});
