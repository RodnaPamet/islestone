/**
 * Per-user scope of `listMyNotifications` / `markNotificationRead` (#5376).
 *
 * A notification belongs to one user in one tenant. Both usecases admit every
 * role (`assertCanRead`), so the ONLY thing standing between user B and user
 * A's notifications is the `userId` + `tenantId` predicate in
 * `NotificationRepository`. These prove it against a real database, for a
 * second user in the SAME tenant and for the same user reaching through
 * ANOTHER tenant:
 *
 *   • B's list never contains A's notifications;
 *   • B marking A's notification read leaves it unread (the usecase answers
 *     `{ success: true }` either way — it does not reveal whether the id
 *     exists — so the row itself is what is checked);
 *   • A's own mark-read does take effect, so the negative cases are not
 *     passing because marking is broken.
 *
 * Sub-phase 2.7c adds the Inbox's usecases (`listInbox`,
 * `updateMyNotification`, `bulkUpdateMyNotifications`): the views, read and
 * unread, Done and back, "mark all read", each held to the caller's own rows.
 *
 * Copied from inflect-compliance `tests/integration/notification-per-user-scope.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: Islestone's roles, the `body`
 * column, the PII-extended test client and `resetDatabase`.
 */
import { MembershipStatus, Role } from '@prisma/client';
import { randomUUID } from 'crypto';

import {
    bulkUpdateMyNotifications,
    listInbox,
    listMyNotifications,
    markNotificationRead,
    updateMyNotification,
} from '@/app-layer/usecases/notification';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { DB_AVAILABLE } from './db-helper';

const globalPrisma = prismaTestClient();
const describeFn = DB_AVAILABLE ? describe : describe.skip;
jest.setTimeout(30_000);

const TAG = `nps-${randomUUID().slice(0, 8)}`;
const TENANT_A = `t-${TAG}-a`;
const TENANT_B = `t-${TAG}-b`;

let userA = '';
let userB = '';
let NOTE_A = '';

async function makeUser(label: string): Promise<string> {
    return (await globalPrisma.user.create({ data: { email: `${TAG}-${label}@example.test` } })).id;
}

async function notify(tenantId: string, userId: string, title: string) {
    return globalPrisma.notification.create({
        data: { tenantId, userId, title: `${TAG} ${title}`, body: 'm' },
    });
}

const ctxFor = (tenantId: string, userId: string, role: Role = Role.VIEWER) =>
    makeRequestContext(role, { tenantId, userId, tenantSlug: tenantId });

beforeAll(async () => {
    if (!DB_AVAILABLE) return;
    await resetDatabase(globalPrisma);
    for (const id of [TENANT_A, TENANT_B]) {
        await globalPrisma.tenant.create({ data: { id, name: id, slug: id } });
    }
    userA = await makeUser('a');
    userB = await makeUser('b');
    // A is in tenant A only; B is in both, so the cross-tenant case is B
    // using a legitimate membership of tenant B to reach tenant A's rows.
    await globalPrisma.tenantMembership.createMany({
        data: [
            { tenantId: TENANT_A, userId: userA, role: Role.VIEWER, status: MembershipStatus.ACTIVE },
            { tenantId: TENANT_A, userId: userB, role: Role.ADMIN, status: MembershipStatus.ACTIVE },
            { tenantId: TENANT_B, userId: userB, role: Role.OWNER, status: MembershipStatus.ACTIVE },
        ],
    });
    NOTE_A = (await notify(TENANT_A, userA, 'for A')).id;
    await notify(TENANT_A, userB, 'for B in A');
    await notify(TENANT_B, userB, 'for B in B');
});

afterAll(async () => {
    if (DB_AVAILABLE) await resetDatabase(globalPrisma);
});

async function isRead(id: string) {
    return (await globalPrisma.notification.findUniqueOrThrow({ where: { id } })).read;
}

describeFn('notifications are scoped to their own user (integration)', () => {
    it('each user lists only their own notifications in the tenant they are in', async () => {
        const aList = await listMyNotifications(ctxFor(TENANT_A, userA));
        expect(aList.map((n) => n.title)).toEqual([`${TAG} for A`]);

        // B is an ADMIN of tenant A — role does not widen the list.
        const bInA = await listMyNotifications(ctxFor(TENANT_A, userB, Role.ADMIN));
        expect(bInA.map((n) => n.title)).toEqual([`${TAG} for B in A`]);
        expect(bInA.some((n) => n.id === NOTE_A)).toBe(false);

        const bInB = await listMyNotifications(ctxFor(TENANT_B, userB, Role.OWNER));
        expect(bInB.map((n) => n.title)).toEqual([`${TAG} for B in B`]);
    });

    it("user B cannot mark user A's notification read in the same tenant", async () => {
        await expect(markNotificationRead(ctxFor(TENANT_A, userB, Role.ADMIN), NOTE_A))
            .resolves.toEqual({ success: true });
        expect(await isRead(NOTE_A)).toBe(false);
    });

    it("user B cannot mark user A's notification read through another tenant", async () => {
        await expect(markNotificationRead(ctxFor(TENANT_B, userB, Role.OWNER), NOTE_A))
            .resolves.toEqual({ success: true });
        expect(await isRead(NOTE_A)).toBe(false);
    });

    it("user A's own notification is not reachable from tenant B even by user A", async () => {
        // A context naming the right user but the wrong tenant matches nothing.
        await markNotificationRead(ctxFor(TENANT_B, userA), NOTE_A);
        expect(await isRead(NOTE_A)).toBe(false);
        expect(await listMyNotifications(ctxFor(TENANT_B, userA))).toEqual([]);
    });

    it('user A can mark their own notification read', async () => {
        await markNotificationRead(ctxFor(TENANT_A, userA), NOTE_A);
        expect(await isRead(NOTE_A)).toBe(true);
    });
});

describeFn('the Inbox: views, read and Done, each the caller\'s own (2.7c)', () => {
    const INBOX_TENANT = `t-${TAG}-inbox`;
    let owner = '';
    let other = '';
    const ids: Record<string, string> = {};

    beforeAll(async () => {
        await globalPrisma.tenant.create({ data: { id: INBOX_TENANT, name: INBOX_TENANT, slug: INBOX_TENANT } });
        owner = await makeUser('inbox-owner');
        other = await makeUser('inbox-other');
        await globalPrisma.tenantMembership.createMany({
            data: [
                { tenantId: INBOX_TENANT, userId: owner, role: Role.MEMBER, status: MembershipStatus.ACTIVE },
                { tenantId: INBOX_TENANT, userId: other, role: Role.ADMIN, status: MembershipStatus.ACTIVE },
            ],
        });
        for (const [key, data] of Object.entries({
            unread1: { read: false },
            unread2: { read: false },
            read: { read: true, readAt: new Date() },
            done: { read: true, archivedAt: new Date() },
        })) {
            ids[key] = (await globalPrisma.notification.create({ data: { tenantId: INBOX_TENANT, userId: owner, title: key, body: 'b', ...data } })).id;
        }
        ids.others = (await notify(INBOX_TENANT, other, 'someone else')).id;
    });

    const ctx = () => ctxFor(INBOX_TENANT, owner, Role.MEMBER);
    const titles = async (view: 'unread' | 'all' | 'done') => (await listInbox(ctx(), { view })).items.map((i) => i.title).sort();

    it('lists Unread, All (not Done) and Done, with the unread count, and never another member\'s row', async () => {
        expect(await titles('unread')).toEqual(['unread1', 'unread2']);
        expect(await titles('all')).toEqual(['read', 'unread1', 'unread2']);
        expect(await titles('done')).toEqual(['done']);
        expect((await listInbox(ctx(), { view: 'all' })).unreadCount).toBe(2);
        // The bell's list leaves Done out too.
        expect((await listMyNotifications(ctx())).map((n) => n.title).sort()).toEqual(['read', 'unread1', 'unread2']);
    });

    it('pages by cursor without skipping or repeating a row', async () => {
        const first = await listInbox(ctx(), { view: 'all', limit: 2 });
        expect(first.items).toHaveLength(2);
        expect(first.pageInfo.hasNextPage).toBe(true);
        const second = await listInbox(ctx(), { view: 'all', limit: 2, cursor: first.pageInfo.nextCursor });
        expect([...first.items, ...second.items].map((i) => i.title).sort()).toEqual(['read', 'unread1', 'unread2']);
        await expect(listInbox(ctx(), { view: 'all', cursor: 'not-a-cursor' })).rejects.toMatchObject({ status: 400 });
    });

    it('marks read and unread, and Done (which reads it) and back', async () => {
        await updateMyNotification(ctx(), ids.unread1!, { read: true });
        let row = await globalPrisma.notification.findUniqueOrThrow({ where: { id: ids.unread1! } });
        expect([row.read, row.readAt !== null]).toEqual([true, true]);
        await updateMyNotification(ctx(), ids.unread1!, { read: false });
        row = await globalPrisma.notification.findUniqueOrThrow({ where: { id: ids.unread1! } });
        expect([row.read, row.readAt]).toEqual([false, null]);

        await updateMyNotification(ctx(), ids.unread1!, { done: true });
        row = await globalPrisma.notification.findUniqueOrThrow({ where: { id: ids.unread1! } });
        expect([row.read, row.archivedAt !== null]).toEqual([true, true]);
        await updateMyNotification(ctx(), ids.unread1!, { done: false, read: false });
        row = await globalPrisma.notification.findUniqueOrThrow({ where: { id: ids.unread1! } });
        expect([row.read, row.archivedAt]).toEqual([false, null]);
    });

    it("another member's Done, read or bulk write changes nothing of the owner's", async () => {
        const otherCtx = ctxFor(INBOX_TENANT, other, Role.ADMIN);
        expect(await updateMyNotification(otherCtx, ids.unread2!, { done: true })).toEqual({ updated: 0 });
        expect(await bulkUpdateMyNotifications(otherCtx, { action: 'update', ids: [ids.unread2!], read: true })).toEqual({ updated: 0 });
        expect(await bulkUpdateMyNotifications(otherCtx, { action: 'mark-all-read' })).toEqual({ updated: 1 });
        const row = await globalPrisma.notification.findUniqueOrThrow({ where: { id: ids.unread2! } });
        expect([row.read, row.archivedAt]).toEqual([false, null]);
    });

    it('"mark all read" reads every unread row still in the Inbox, and only the caller\'s', async () => {
        const r = await bulkUpdateMyNotifications(ctx(), { action: 'mark-all-read' });
        expect(r.updated).toBe(2);
        expect((await listInbox(ctx(), { view: 'unread' })).items).toEqual([]);
        expect(await titles('done')).toEqual(['done']);
    });
});
