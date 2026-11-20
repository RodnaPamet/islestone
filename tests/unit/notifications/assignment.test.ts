/**
 * Unit coverage for the assignment notification module. Pins the behavioural
 * contract of the helper:
 *
 *   1. dedupeKey shape: `{tenantId}:{TYPE}:{entityId}:{userId}:{YYYY-MM-DD}`.
 *   2. duplicate calls within one day collapse (skipDuplicates).
 *   3. the row carries the caller's tenant-scoped link and the item label.
 *   4. a muted type writes nothing and publishes nothing.
 *   5. a fresh insert reaches the SSE bus with the ROW's id; a duplicate and
 *      another user's subscription do not.
 *
 * Copied from inflect-compliance `tests/unit/notifications/assignment.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e and rewritten over Islestone's
 * one kind (`WORK_ITEM_ASSIGNED`): the control, risk and asset link cases are
 * not ported, the link is the caller's (2.3 owns the route), and the muted
 * case is new.
 */

import {
    buildAssignmentDedupeKey,
    createAssignmentNotification,
    type AssignmentTarget,
} from '@/app-layer/notifications/assignment';
import {
    __resetNotificationBusForTests,
    subscribeToNotifications,
    type NotificationEvent,
} from '@/lib/notifications/notification-bus';

const NOW = new Date('2026-05-28T12:00:00Z');

function makeTarget(overrides: Partial<AssignmentTarget> = {}): AssignmentTarget {
    return {
        tenantId: 'tenant-1',
        assigneeUserId: 'user-1',
        entityId: 'wi-1',
        entityLabel: 'Patch firewall',
        entityKey: 'ISL-42',
        linkUrl: '/t/acme/work-items/wi-1',
        ...overrides,
    };
}

/**
 * `findMany` by `dedupeKey`, as the helper reads the inserted rows back
 * (inflect #5305): each key gets a row id that is NOT the key, so an event
 * still carrying the dedupe key as its id fails the assertions below.
 */
const insertedRows = () =>
    jest.fn(async ({ where }: { where: { dedupeKey: { in: string[] } } }) =>
        where.dedupeKey.in.map((dedupeKey, i) => ({
            id: `notif-row-${i + 1}`,
            dedupeKey,
            createdAt: new Date('2026-05-28T12:00:05Z'),
        })),
    );

function makeDb(opts: { count?: number; muted?: string[]; prefs?: Array<{ userId: string; type: string; inApp: boolean; emailDelivery: string }> } = {}) {
    return {
        notification: {
            createMany: jest.fn(async () => ({ count: opts.count ?? 1 })),
            findMany: insertedRows(),
        },
        tenantNotificationSettings: {
            findUnique: jest.fn(async () => (opts.muted ? { mutedInAppTypes: opts.muted } : null)),
        },
        // Sub-phase 2.7c: the member's own preference, read in the same seam.
        notificationPreference: {
            findMany: jest.fn(async ({ where }: { where: { type: string; userId: { in: string[] } } }) =>
                (opts.prefs ?? []).filter((p) => p.type === where.type && where.userId.in.includes(p.userId)),
            ),
        },
    };
}

beforeEach(() => {
    __resetNotificationBusForTests();
});

describe('buildAssignmentDedupeKey', () => {
    it('formats as tenantId:TYPE:entityId:userId:YYYY-MM-DD', () => {
        expect(buildAssignmentDedupeKey('tenant-1', 'WORK_ITEM_ASSIGNED', 'wi-1', 'user-1', NOW)).toBe(
            'tenant-1:WORK_ITEM_ASSIGNED:wi-1:user-1:2026-05-28',
        );
    });

    it('a different day produces a different key; the same day the same key', () => {
        const a = buildAssignmentDedupeKey('t', 'WORK_ITEM_ASSIGNED', 'e', 'u', new Date('2026-05-28T00:00:01Z'));
        const b = buildAssignmentDedupeKey('t', 'WORK_ITEM_ASSIGNED', 'e', 'u', new Date('2026-05-28T23:59:59Z'));
        const c = buildAssignmentDedupeKey('t', 'WORK_ITEM_ASSIGNED', 'e', 'u', new Date('2026-05-29T00:00:01Z'));
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });
});

describe('createAssignmentNotification', () => {
    it('returns "created" when a new row is inserted, "duplicate" when skipDuplicates collapses it', async () => {
        expect(await createAssignmentNotification(makeDb() as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW)).toEqual({
            status: 'created',
        });
        expect(
            await createAssignmentNotification(makeDb({ count: 0 }) as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW),
        ).toEqual({ status: 'duplicate' });
    });

    it('writes one WORK_ITEM_ASSIGNED row for the assignee, with the caller\'s link and skipDuplicates', async () => {
        const db = makeDb();
        await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget({ assigneeUserId: 'assignee-9' }), NOW);
        const call = (db.notification.createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[]; skipDuplicates: boolean }])[0];
        expect(call.skipDuplicates).toBe(true);
        expect(call.data).toHaveLength(1);
        expect(call.data[0]).toEqual({
            tenantId: 'tenant-1',
            userId: 'assignee-9',
            type: 'WORK_ITEM_ASSIGNED',
            title: 'You were assigned a work item',
            body: 'ISL-42 "Patch firewall" is now yours.',
            linkUrl: '/t/acme/work-items/wi-1',
            workItemId: 'wi-1',
            dedupeKey: 'tenant-1:WORK_ITEM_ASSIGNED:wi-1:assignee-9:2026-05-28',
        });
    });

    it('falls back to just `"entityLabel"` when the key is null', async () => {
        const db = makeDb();
        await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget({ entityKey: null }), NOW);
        const row = (db.notification.createMany.mock.calls[0] as unknown as [{ data: { body: string }[] }])[0].data[0]!;
        expect(row.body).toBe('"Patch firewall" is now yours.');
    });

    it('writes NOTHING and publishes NOTHING when the workspace muted the type', async () => {
        const db = makeDb({ muted: ['WORK_ITEM_ASSIGNED'] });
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'user-1', send: (e) => received.push(e) });

        const result = await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW);

        expect(result).toEqual({ status: 'muted' });
        expect(db.notification.createMany).not.toHaveBeenCalled();
        expect(received).toEqual([]);
        expect(db.tenantNotificationSettings.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
        );
    });

    it('writes nothing when the recipient switched the type off (2.7c), and names the item otherwise', async () => {
        const off = makeDb({ prefs: [{ userId: 'user-1', type: 'WORK_ITEM_ASSIGNED', inApp: false, emailDelivery: 'IMMEDIATE' }] });
        expect(await createAssignmentNotification(off as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW)).toEqual({ status: 'muted' });
        expect(off.notification.createMany).not.toHaveBeenCalled();
        const on = makeDb();
        await createAssignmentNotification(on as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW);
        const data = (on.notification.createMany.mock.calls[0] as unknown as [{ data: Array<{ workItemId: string }> }])[0].data;
        expect(data[0]!.workItemId).toBe(makeTarget().entityId);
    });

    it('a mute of ANOTHER type does not silence this one', async () => {
        const db = makeDb({ muted: ['WORK_ITEM_WATCH_UPDATE'] });
        expect(await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW)).toEqual({
            status: 'created',
        });
    });
});

describe('createAssignmentNotification — SSE publish', () => {
    it('fans the event to the SSE bus when the row inserts, with the ROW id', async () => {
        const db = makeDb();
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'user-1', send: (e) => received.push(e) });

        await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
            id: 'notif-row-1',
            type: 'WORK_ITEM_ASSIGNED',
            title: 'You were assigned a work item',
            body: 'ISL-42 "Patch firewall" is now yours.',
            read: false,
            linkUrl: '/t/acme/work-items/wi-1',
            createdAt: '2026-05-28T12:00:05.000Z',
        });
        expect(db.notification.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenantId: 'tenant-1', dedupeKey: { in: ['tenant-1:WORK_ITEM_ASSIGNED:wi-1:user-1:2026-05-28'] } },
            }),
        );
    });

    it('SKIPS the bus publish when skipDuplicates collapses the insert', async () => {
        const db = makeDb({ count: 0 });
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'user-1', send: (e) => received.push(e) });

        await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW);

        expect(received).toEqual([]);
        expect(db.notification.findMany).not.toHaveBeenCalled();
    });

    it('does NOT publish to a subscriber on a different (tenant, user)', async () => {
        const db = makeDb();
        const other: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'someone-else', send: (e) => other.push(e) });
        subscribeToNotifications({ tenantId: 'tenant-2', userId: 'user-1', send: (e) => other.push(e) });

        await createAssignmentNotification(db as never, 'WORK_ITEM_ASSIGNED', makeTarget(), NOW);

        expect(other).toEqual([]);
    });
});
