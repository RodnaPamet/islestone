/**
 * A bell row pushed over SSE carries the id of the row that was written
 * (inflect #5305).
 *
 * `createMany` returns no ids, so the helpers once pushed each event with a
 * synthetic id — the dedupe key. The bell marks a row read with
 * `PATCH …/notifications/<id>`, so a freshly pushed row's mark-read named no
 * notification: it failed, and the row came back unread on the next refetch.
 *
 * Against the real database, so the id compared is the one Postgres assigned
 * and the list and the PATCH use.
 *
 * Copied from inflect-compliance `tests/integration/notification-push-carries-row-id.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: DB-gated, over Islestone's two
 * bell writers (assignment and watcher; the due reminder is 2.2), with the
 * caller's link and `resetDatabase`.
 */
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import { createAssignmentNotification } from '@/app-layer/notifications/assignment';
import { createWatcherNotifications } from '@/app-layer/notifications/watcher';
import {
    __resetNotificationBusForTests,
    subscribeToNotifications,
    type NotificationEvent,
} from '@/lib/notifications/notification-bus';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('an SSE-pushed bell row carries its real Notification id', () => {
    let prisma: PrismaClient;
    const SUITE = randomUUID().slice(0, 8);
    const T = `notif-push-${SUITE}`;
    let userId = '';
    let received: NotificationEvent[] = [];
    const target = () => ({
        tenantId: T,
        assigneeUserId: userId,
        entityId: `wi-${SUITE}`,
        entityLabel: 'Patch the firewall',
        entityKey: 'ISL-1',
        linkUrl: `/t/${T}/work-items/wi-${SUITE}`,
    });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        await prisma.tenant.create({ data: { id: T, name: T, slug: T } });
        userId = (await prisma.user.create({ data: { email: `bell@${SUITE}.test` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId: T, userId, role: 'MEMBER', status: 'ACTIVE' } });
    });

    beforeEach(() => {
        __resetNotificationBusForTests();
        received = [];
        subscribeToNotifications({ tenantId: T, userId, send: (e) => received.push(e) });
    });

    afterAll(async () => {
        __resetNotificationBusForTests();
        await resetDatabase(prisma);
    });

    /** The pushed event names a row the bell can PATCH, and it is the row just written. */
    async function expectPushedRowIsStored(type: string) {
        expect(received).toHaveLength(1);
        const row = await prisma.notification.findUnique({ where: { id: received[0]!.id } });
        expect(row).toMatchObject({ tenantId: T, userId, type });
    }

    it('work-item assignment', async () => {
        await createAssignmentNotification(prisma, 'WORK_ITEM_ASSIGNED', target());
        await expectPushedRowIsStored('WORK_ITEM_ASSIGNED');
    });

    it('a watched work-item update', async () => {
        await createWatcherNotifications(prisma, [userId], {
            tenantId: T,
            workItemId: `watched-${SUITE}`,
            workItemKey: 'ISL-3',
            workItemTitle: 'Review access',
            linkUrl: `/t/${T}/work-items/watched-${SUITE}`,
            kind: 'commented',
            discriminator: 'comment-1',
            detail: 'new comment added',
        });
        await expectPushedRowIsStored('WORK_ITEM_WATCH_UPDATE');
    });

    it('a duplicate pushes nothing — the control', async () => {
        // Same entity, same user, same day as the first case: deduped.
        const out = await createAssignmentNotification(prisma, 'WORK_ITEM_ASSIGNED', target());
        expect(out.status).toBe('duplicate');
        expect(received).toHaveLength(0);
    });
});
