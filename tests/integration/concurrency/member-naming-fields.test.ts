/**
 * Fields that name a member through a key that refuses the member's removal,
 * racing that removal (Hardening H2; issue #113, owner decision 280).
 *
 * The assignee and waiting on (`RESTRICT`), a person custom-field value
 * (`NO ACTION`) and a goal's or initiative's Lead (`RESTRICT`) name the
 * membership through a key that refuses its delete instead of cascading; a
 * review step's reviewer names the user, and a template's assignee has no
 * key at all. `removeTenantMember` cleared these, then deleted the
 * membership: a write that set one of them in between made the removal fail
 * (the key refused the delete) or left a non-member named.
 *
 * Decision 280: the removal locks the membership after its first clearing
 * pass, clears again, then deletes it, in one transaction; every writer of
 * these fields locks its own row first, then the person's membership
 * `FOR KEY SHARE` (`MembershipRepository.lockActiveUserIds`, issue #111's
 * order), and refuses a person who is gone with a 400.
 *
 * Two interleavings per writer, each shown deterministically (waiting on
 * `pg_stat_activity`, never timed):
 *
 *   - the writer gets in first: a transaction holds the person's membership
 *     `FOR KEY SHARE`, as a writer that has checked the person holds it; the
 *     REAL removal runs and is seen waiting on it; the writer runs to its
 *     commit; then the holder commits. The removal must succeed and leave
 *     nobody naming the person. Measured before the fix on 2026-11-27: the
 *     removal failed on the key for the assignee, waiting on, the person
 *     value and both Leads, and succeeded leaving the person named as a
 *     pending reviewer and a template's assignee.
 *   - the removal gets in first: another transaction plays the removal in
 *     its new order (its items locked and cleared, the membership locked),
 *     the writer starts and is seen waiting on a lock, then the membership is
 *     deleted and committed. The writer must be refused with a 400 and write
 *     nothing. Measured before the fix: the writers behind a key failed with
 *     P2003 (a 500), the reviewer and template writers did not wait at all
 *     and named the person.
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createCustomField, setWorkItemCustomFieldValue } from '@/app-layer/usecases/custom-field';
import { createGoal, updateGoal } from '@/app-layer/usecases/goal';
import { createInitiative, updateInitiative } from '@/app-layer/usecases/initiative';
import { addReviewStepReviewer, setWorkItemReviewSteps } from '@/app-layer/usecases/review';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { assignWorkItem, bulkAssignWorkItems, createWorkItem, setWorkItemWaitingOn } from '@/app-layer/usecases/work-item';
import { createWorkItemTemplate, updateWorkItemTemplate } from '@/app-layer/usecases/work-item-template';

import { prismaTestClient, resetDatabase } from '../../helpers/db';
import { untilSessionsWaitOnLocks } from '../../helpers/lock-waits';
import { makeRequestContext } from '../../helpers/make-context';
import { rounds, scaledTimeout } from '../../helpers/stress-scale';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../../helpers/work-item-workspace';

import { DB_AVAILABLE } from '../db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `mnfd${Date.now().toString(36)}`;

describeFn('concurrency: fields naming a member against that member\'s removal (issue #113)', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;
    let personFieldId = '';
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
        personFieldId = (await createCustomField(ws.owner, ws.projectId, { name: 'Contact', type: 'PERSON' })).id;
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

    const newItem = (title: string, extra: Record<string, unknown> = {}) =>
        createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title, ...extra });

    /** Every place a removed person could still be named, counted; all zero after a removal. */
    async function stillNamed(userId: string) {
        const [items, waiting, values, goals, initiatives, templates, reviewers] = await Promise.all([
            prisma.workItem.count({ where: { tenantId: ws.tenantId, assigneeId: userId } }),
            prisma.workItem.count({ where: { tenantId: ws.tenantId, waitingOnUserId: userId } }),
            prisma.customFieldValue.count({ where: { tenantId: ws.tenantId, userId } }),
            prisma.goal.count({ where: { tenantId: ws.tenantId, leadUserId: userId } }),
            prisma.initiative.count({ where: { tenantId: ws.tenantId, leadUserId: userId } }),
            prisma.workItemTemplate.count({ where: { tenantId: ws.tenantId, assigneeId: userId } }),
            prisma.workItemReviewer.count({ where: { tenantId: ws.tenantId, userId, withdrawnAt: null, outcome: null } }),
        ]);
        return { items, waiting, values, goals, initiatives, templates, reviewers };
    }
    const NOBODY = { items: 0, waiting: 0, values: 0, goals: 0, initiatives: 0, templates: 0, reviewers: 0 };

    function fulfilled<T>(settled: PromiseSettledResult<T>): T {
        // On failure this prints the reason.
        expect(settled.status === 'rejected' ? String((settled as PromiseRejectedResult).reason) : 'fulfilled').toBe('fulfilled');
        return (settled as PromiseFulfilledResult<T>).value;
    }

    function refusedWith(settled: PromiseSettledResult<unknown>, status: number) {
        expect(settled.status === 'rejected' ? 'rejected' : `fulfilled: ${JSON.stringify((settled as PromiseFulfilledResult<unknown>).value)?.slice(0, 200)}`).toBe('rejected');
        const reason = (settled as PromiseRejectedResult).reason;
        expect(String(reason)).not.toMatch(/P2003|foreign key|deadlock|40P01/i);
        expect(reason).toMatchObject({ status });
    }

    /**
     * The writer gets in first. A transaction holds the person's membership
     * `FOR KEY SHARE` (as a writer that has checked them holds it); the real
     * removal starts and is seen waiting on it; `write` runs to its commit;
     * then the holder commits and the removal finishes.
     */
    async function writerFirst<T>(lee: Leaver, write: () => Promise<T>) {
        let removal: Promise<unknown> | undefined;
        let written: PromiseSettledResult<T> | undefined;
        await prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT "id" FROM "TenantMembership" WHERE "id" = ${lee.membershipId} FOR KEY SHARE`;
                removal = removeTenantMember(ws.owner, { membershipId: lee.membershipId });
                removal.catch(() => undefined);
                await untilSessionsWaitOnLocks(prisma);
                [written] = await Promise.allSettled([write()]);
            },
            { timeout: 60_000, maxWait: 10_000 },
        );
        const [removed] = await Promise.allSettled([removal!]);
        return { removal: removed!, write: written! };
    }

    /**
     * The removal gets in first, played in its new order: the items it
     * writes locked in id order and cleared, then the membership locked;
     * `write` starts and is seen waiting on a lock; then the membership is
     * deleted and committed.
     */
    async function removalFirst<T>(lee: Leaver, write: () => Promise<T>) {
        let pending: Promise<T> | undefined;
        const removal = await prisma
            .$transaction(
                async (tx) => {
                    await tx.$queryRaw`
                        SELECT "id" FROM "WorkItem"
                         WHERE "tenantId" = ${ws.tenantId} AND (${lee.userId} IN ("assigneeId", "waitingOnUserId"))
                         ORDER BY "id" FOR UPDATE`;
                    await tx.$executeRaw`UPDATE "WorkItem" SET "assigneeId" = NULL WHERE "tenantId" = ${ws.tenantId} AND "assigneeId" = ${lee.userId}`;
                    await tx.$executeRaw`UPDATE "WorkItem" SET "waitingOnUserId" = NULL WHERE "tenantId" = ${ws.tenantId} AND "waitingOnUserId" = ${lee.userId}`;
                    await tx.$queryRaw`SELECT "id" FROM "TenantMembership" WHERE "id" = ${lee.membershipId} FOR UPDATE`;
                    pending = write();
                    // An unhandled rejection before the await below would fail the run.
                    pending.catch(() => undefined);
                    await untilSessionsWaitOnLocks(prisma);
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

    /** One case per writer: what to set up, then the write that names the person. */
    interface Case {
        name: string;
        write: (lee: Leaver) => Promise<() => Promise<unknown>>;
    }
    const CASES: Case[] = [
        {
            name: 'assigning an item',
            write: async (lee) => {
                const item = await newItem(`assign ${seq}`);
                return () => assignWorkItem(ws.owner, item.id, { assigneeId: lee.userId });
            },
        },
        {
            name: 'assigning items in bulk',
            write: async (lee) => {
                const a = await newItem(`bulk a ${seq}`);
                const b = await newItem(`bulk b ${seq}`);
                return () => bulkAssignWorkItems(ws.owner, { workItemIds: [a.id, b.id], assigneeId: lee.userId });
            },
        },
        {
            name: 'naming whom an item waits on',
            write: async (lee) => {
                const item = await newItem(`waiting ${seq}`);
                return () => setWorkItemWaitingOn(ws.owner, item.id, { userId: lee.userId });
            },
        },
        {
            name: 'a person field value',
            write: async (lee) => {
                const item = await newItem(`person ${seq}`);
                return () => setWorkItemCustomFieldValue(ws.owner, item.id, personFieldId, lee.userId);
            },
        },
        {
            name: 'creating an item assigned to them and waiting on them',
            write: async (lee) => () => newItem(`created ${seq}`, { assigneeId: lee.userId, waitingOnUserId: lee.userId }),
        },
        {
            name: 'creating an item with them in a person field',
            write: async (lee) => () => newItem(`created person ${seq}`, { customFields: { [personFieldId]: lee.userId } }),
        },
        {
            name: 'creating a goal they lead',
            write: async (lee) => () => createGoal(ws.owner, { title: `goal ${seq}`, leadUserId: lee.userId }),
        },
        {
            name: 'making them a goal\'s Lead',
            write: async (lee) => {
                const goal = await createGoal(ws.owner, { title: `led goal ${seq}` });
                return () => updateGoal(ws.owner, goal.id, { leadUserId: lee.userId });
            },
        },
        {
            name: 'creating an initiative they lead',
            write: async (lee) => () => createInitiative(ws.owner, { name: `initiative ${seq}`, leadUserId: lee.userId }),
        },
        {
            name: 'making them an initiative\'s Lead',
            write: async (lee) => {
                const initiative = await createInitiative(ws.owner, { name: `led initiative ${seq}` });
                return () => updateInitiative(ws.owner, initiative.id, { leadUserId: lee.userId });
            },
        },
        {
            name: 'naming them on a review step',
            write: async (lee) => {
                const item = await newItem(`review ${seq}`);
                return () =>
                    setWorkItemReviewSteps(ws.owner, item.id, {
                        steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [lee.userId], recipientListIds: [] }],
                    });
            },
        },
        {
            name: 'adding them as a reviewer',
            write: async (lee) => {
                const item = await newItem(`reviewer ${seq}`);
                await setWorkItemReviewSteps(ws.owner, item.id, {
                    steps: [{ name: 'Check', mode: 'ALL', dueInWorkingDays: 2, memberIds: [ws.memberUserId], recipientListIds: [] }],
                });
                const step = await prisma.workItemReviewStep.findFirstOrThrow({ where: { workItemId: item.id }, select: { id: true } });
                return () => addReviewStepReviewer(ws.owner, item.id, step.id, { userId: lee.userId });
            },
        },
        {
            name: 'creating a template assigned to them',
            write: async (lee) => () => createWorkItemTemplate(ws.owner, ws.projectId, { name: `template ${seq}`, title: 'From a template', assigneeId: lee.userId }),
        },
        {
            name: 'assigning a template to them',
            write: async (lee) => {
                const template = await createWorkItemTemplate(ws.owner, ws.projectId, { name: `assigned template ${seq}`, title: 'From a template' });
                return () => updateWorkItemTemplate(ws.owner, ws.projectId, template.id, { assigneeId: lee.userId });
            },
        },
    ];
    const BY_NAME = CASES.map((c) => [c.name, c] as const);

    it.each(BY_NAME)('%s, committed while the removal waits: the removal succeeds and nobody names them', async (_name, c) => {
        const lee = await leaver();
        const write = await c.write(lee);
        const outcome = await writerFirst(lee, write);
        fulfilled(outcome.write);
        fulfilled(outcome.removal);
        expect(await prisma.tenantMembership.count({ where: { id: lee.membershipId } })).toBe(0);
        expect(await stillNamed(lee.userId)).toEqual(NOBODY);
    });

    it.each(BY_NAME)('%s, after the removal locked the membership: a 400, nothing written', async (_name, c) => {
        const lee = await leaver();
        const write = await c.write(lee);
        const outcome = await removalFirst(lee, write);
        expect(outcome.removal).toBe('committed');
        refusedWith(outcome.write, 400);
        expect(await stillNamed(lee.userId)).toEqual(NOBODY);
    });

    it('assigning an item the removal holds (it waits on them): the writer waits for the item, then a 400', async () => {
        const lee = await leaver();
        const item = await newItem(`held ${seq}`, { waitingOnUserId: lee.userId });
        const outcome = await removalFirst(lee, () => assignWorkItem(ws.owner, item.id, { assigneeId: lee.userId }));
        expect(outcome.removal).toBe('committed');
        refusedWith(outcome.write, 400);
        expect(await stillNamed(lee.userId)).toEqual(NOBODY);
    });

    it('a sub-item assigned to them under an item the removal holds: no deadlock, a 400', async () => {
        const lee = await leaver();
        const parent = await newItem(`parent ${seq}`, { assigneeId: lee.userId });
        const outcome = await removalFirst(lee, () => newItem(`child ${seq}`, { parentId: parent.id, assigneeId: lee.userId }));
        expect(outcome.removal).toBe('committed');
        refusedWith(outcome.write, 400);
        expect(await stillNamed(lee.userId)).toEqual(NOBODY);
    });

    it('every writer naming a member racing the real removal: the removal always succeeds, never a deadlock, nobody left naming them', async () => {
        const isTyped = (reason: unknown) => typeof (reason as { status?: unknown }).status === 'number' && (reason as { status: number }).status < 500;
        for (let round = 0; round < rounds(3); round++) {
            const lee = await leaver();
            // Rows naming them already, so the removal's first pass has work.
            await newItem(`theirs ${round}`, { assigneeId: lee.userId });
            await newItem(`awaits ${round}`, { waitingOnUserId: lee.userId });
            const writes: Array<() => Promise<unknown>> = [];
            for (const c of CASES) {
                // guardrail-allow: n+1 — the test's own setup, one row per writer.
                writes.push(await c.write(lee));
            }
            const settled = await Promise.allSettled([removeTenantMember(ws.owner, { membershipId: lee.membershipId }), ...writes.map((w) => w())]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock).map(String)).toEqual([]);
            expect(failures.filter((f) => !isTyped(f)).map(String)).toEqual([]);
            fulfilled(settled[0]!);
            expect(await prisma.tenantMembership.count({ where: { id: lee.membershipId } })).toBe(0);
            expect(await stillNamed(lee.userId)).toEqual(NOBODY);
        }
    }, scaledTimeout(120_000));
});
