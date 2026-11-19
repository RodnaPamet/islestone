/**
 * The due-date reminder helper (`work-item-due.ts`): the 7/1/0-day windows,
 * the reminder zone, date-only due dates (risk 6 of the 2.1–2.2 map: a
 * `@db.Date` reads back as UTC midnight, and must not slip a day west of
 * UTC), the dedupe key, the mute, and the batch form's ONE write and ONE
 * read-back per page.
 *
 * Copied in shape from inflect-compliance's `tests/unit/task-due-notification.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, with the date-only and paged
 * cases the map adds.
 */
jest.mock('@/lib/notifications/notification-bus', () => ({ publishNotificationEvent: jest.fn() }));

import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import {
    buildWorkItemDueDedupeKey,
    classifyDueWindow,
    createWorkItemDueNotification,
    createWorkItemDueNotifications,
    daysUntilDue,
    todayInTz,
    type WorkItemDueTarget,
} from '@/app-layer/notifications/work-item-due';

const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
const NOW = new Date('2030-03-10T09:00:00Z');

function target(id: string, due: string): WorkItemDueTarget {
    return { id, tenantId: 't1', tenantSlug: 'acme', title: `Item ${id}`, key: `ISL-${id}`, dueDate: dateOnly(due), assigneeUserId: 'u1' };
}

function fakeDb(opts: { muted?: boolean } = {}) {
    const createMany = jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    const findMany = jest.fn(async ({ where }: { where: { dedupeKey: { in: string[] } } }) =>
        where.dedupeKey.in.map((k, i) => ({ id: `n${i}`, dedupeKey: k, createdAt: new Date() })),
    );
    const settings = jest.fn(async () => (opts.muted ? { mutedInAppTypes: ['WORK_ITEM_DUE'] } : null));
    return {
        db: { notification: { createMany, findMany }, tenantNotificationSettings: { findUnique: settings, findFirst: settings } } as never,
        createMany,
        findMany,
    };
}

describe('windows', () => {
    it.each([
        ['2030-03-10', 'today'],
        ['2030-03-11', 'day'],
        ['2030-03-17', 'week'],
        ['2030-03-13', null],
        ['2030-03-09', null],
    ])('due %s → %s', (due, window) => {
        expect(classifyDueWindow(dateOnly(due), NOW, 'UTC')).toBe(window);
    });

    it('reads a date-only due day without a zone shift, west and east of UTC', () => {
        // 05:00 in New York, 18:00 in Tokyo: "today" differs, the due day never moves.
        expect(daysUntilDue(dateOnly('2030-03-10'), NOW, 'America/New_York')).toBe(0);
        expect(daysUntilDue(dateOnly('2030-03-11'), NOW, 'Asia/Tokyo')).toBe(1);
        expect(daysUntilDue(dateOnly('2030-03-10'), new Date('2030-03-10T02:00:00Z'), 'America/Los_Angeles')).toBe(1);
        expect(todayInTz(new Date('2030-03-10T02:00:00Z'), 'America/Los_Angeles').toISOString()).toBe('2030-03-09T00:00:00.000Z');
    });

    it('the dedupe key names the window, the item, the person and the run day in the zone', () => {
        expect(buildWorkItemDueDedupeKey('t1', 'day', 'w1', 'u1', NOW, 'UTC')).toBe('t1:WORK_ITEM_DUE:day:w1:u1:2030-03-10');
    });
});

describe('writes', () => {
    beforeEach(() => (publishNotificationEvent as jest.Mock).mockClear());

    it('a page is ONE createMany and ONE read-back, then a push per inserted row', async () => {
        const { db, createMany, findMany } = fakeDb();
        const r = await createWorkItemDueNotifications(db, 't1', [target('1', '2030-03-10'), target('2', '2030-03-11'), target('3', '2030-03-13')], NOW, 'UTC');
        expect(r).toEqual({ created: 2, candidates: 2, muted: false });
        expect(createMany).toHaveBeenCalledTimes(1);
        expect(findMany).toHaveBeenCalledTimes(1);
        expect(publishNotificationEvent).toHaveBeenCalledTimes(2);
        const rows = createMany.mock.calls[0]![0].data as Array<{ linkUrl: string; body: string; type: string }>;
        expect(rows[0]).toMatchObject({ type: 'WORK_ITEM_DUE', linkUrl: '/t/acme/work-items/1', body: 'ISL-1 "Item 1" is due today.' });
    });

    it('a muted type writes nothing', async () => {
        const { db, createMany } = fakeDb({ muted: true });
        const r = await createWorkItemDueNotification(db, target('1', '2030-03-10'), NOW, 'UTC');
        expect(r.status).toBe('muted');
        expect(createMany).not.toHaveBeenCalled();
    });

    it('an item off every window writes nothing and asks nothing', async () => {
        const { db, createMany } = fakeDb();
        expect(await createWorkItemDueNotification(db, target('1', '2030-04-01'), NOW, 'UTC')).toEqual({ status: 'out-of-window', window: null });
        expect(createMany).not.toHaveBeenCalled();
    });
});
