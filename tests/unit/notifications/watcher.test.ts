/**
 * Unit coverage for the watcher notification helper. Watching a work item
 * must deliver activity (comment / status / assign) to the bell.
 *
 *   1. dedupeKey shape keys on kind + discriminator so distinct events
 *      don't collapse, but a retry of the same event dedupes.
 *   2. one bell row per watcher, type WORK_ITEM_WATCH_UPDATE, the caller's link.
 *   3. empty watcher set is a no-op (no createMany).
 *   4. a muted type writes and publishes nothing.
 *   5. SSE publish on insert, skipped on duplicate.
 *
 * Copied from inflect-compliance `tests/unit/notifications/watcher.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (task fields renamed to work-item
 * fields, the muted case added).
 */

import {
    buildWatcherDedupeKey,
    createWatcherNotifications,
    type WatcherActivity,
} from '@/app-layer/notifications/watcher';
import {
    __resetNotificationBusForTests,
    subscribeToNotifications,
    type NotificationEvent,
} from '@/lib/notifications/notification-bus';

function activity(overrides: Partial<WatcherActivity> = {}): WatcherActivity {
    return {
        tenantId: 'tenant-1',
        workItemId: 'wi-1',
        workItemKey: 'ISL-42',
        workItemTitle: 'Patch the firewall',
        linkUrl: '/t/acme/work-items/wi-1',
        kind: 'commented',
        discriminator: 'comment-1',
        detail: 'new comment added',
        ...overrides,
    };
}

describe('buildWatcherDedupeKey', () => {
    it('keys on tenant:WORK_ITEM_WATCH:item:watcher:kind:discriminator', () => {
        const key = buildWatcherDedupeKey(activity(), 'watcher-1');
        expect(key).toBe('tenant-1:WORK_ITEM_WATCH:wi-1:watcher-1:commented:comment-1');
    });

    it('distinct events (different discriminator) produce distinct keys', () => {
        const a = buildWatcherDedupeKey(activity({ discriminator: 'comment-1' }), 'w1');
        const b = buildWatcherDedupeKey(activity({ discriminator: 'comment-2' }), 'w1');
        expect(a).not.toBe(b);
    });

    it('distinct kinds produce distinct keys', () => {
        const c = buildWatcherDedupeKey(activity({ kind: 'commented', discriminator: 'x' }), 'w1');
        const s = buildWatcherDedupeKey(activity({ kind: 'status_changed', discriminator: 'x' }), 'w1');
        expect(c).not.toBe(s);
    });
});

describe('createWatcherNotifications', () => {
    let createManyMock: jest.Mock;
    let db: {
        notification: { createMany: jest.Mock };
        tenantNotificationSettings: { findUnique: jest.Mock };
    };

    beforeEach(() => {
        createManyMock = jest.fn().mockResolvedValue({ count: 2 });
        db = {
            notification: { createMany: createManyMock },
            tenantNotificationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        };
    });

    it('writes one WORK_ITEM_WATCH_UPDATE row per watcher with the caller\'s link', async () => {
        await createWatcherNotifications(db as never, ['w1', 'w2'], activity({ linkUrl: '/t/acme/work-items/wi-X' }));
        const args = createManyMock.mock.calls[0][0];
        expect(args.skipDuplicates).toBe(true);
        expect(args.data).toHaveLength(2);
        for (const row of args.data) {
            expect(row.type).toBe('WORK_ITEM_WATCH_UPDATE');
            expect(row.title).toBe('Watched work item updated');
            expect(row.linkUrl).toBe('/t/acme/work-items/wi-X');
        }
        expect(args.data.map((r: { userId: string }) => r.userId).sort()).toEqual(['w1', 'w2']);
    });

    it('body carries the item key + label + activity detail', async () => {
        await createWatcherNotifications(db as never, ['w1'], activity({
            workItemKey: 'ISL-9', workItemTitle: 'Rotate keys', detail: 'status changed OPEN → IN_REVIEW',
        }));
        const row = createManyMock.mock.calls[0][0].data[0];
        expect(row.body).toBe('ISL-9 "Rotate keys": status changed OPEN → IN_REVIEW');
    });

    it('writes nothing for a workspace that muted the type ({ created: 0 })', async () => {
        db.tenantNotificationSettings.findUnique.mockResolvedValue({ mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] });
        const result = await createWatcherNotifications(db as never, ['w1', 'w2'], activity());
        expect(result).toEqual({ created: 0 });
        expect(createManyMock).not.toHaveBeenCalled();
    });

    it('is a no-op for an empty watcher set (no createMany, created 0)', async () => {
        const result = await createWatcherNotifications(db as never, [], activity());
        expect(createManyMock).not.toHaveBeenCalled();
        expect(result.created).toBe(0);
    });
});

/**
 * `findMany` by `dedupeKey`, as the helper reads the inserted rows back
 * (inflect #5305): each key gets a row id that is NOT the key, so an event still
 * carrying the dedupe key as its id fails the assertions below.
 */
const insertedRows = () =>
    jest.fn(async ({ where }: { where: { dedupeKey: { in: string[] } } }) =>
        where.dedupeKey.in.map((dedupeKey, i) => ({
            id: `notif-row-${i + 1}`,
            dedupeKey,
            createdAt: new Date('2026-05-28T12:00:05Z'),
        })),
    );

describe('createWatcherNotifications — SSE publish', () => {
    let createManyMock: jest.Mock;
    let db: {
        notification: { createMany: jest.Mock; findMany: jest.Mock };
        tenantNotificationSettings: { findUnique: jest.Mock };
    };

    beforeEach(() => {
        __resetNotificationBusForTests();
        createManyMock = jest.fn();
        db = {
            notification: { createMany: createManyMock, findMany: insertedRows() },
            tenantNotificationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        };
    });

    it('fans each watcher event to the bus when rows insert (count > 0)', async () => {
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'w1', send: (e) => received.push(e) });

        createManyMock.mockResolvedValueOnce({ count: 1 });
        await createWatcherNotifications(db as never, ['w1'], activity(), new Date('2026-07-17T12:00:00Z'));

        expect(received).toHaveLength(1);
        expect(received[0].type).toBe('WORK_ITEM_WATCH_UPDATE');
        expect(received[0].body).toBe('ISL-42 "Patch the firewall": new comment added');
        // The ROW's id, not the dedupe key it used to carry (inflect #5305).
        expect(received[0].id).toBe('notif-row-1');
    });

    it('publishes nothing for a muted type', async () => {
        db.tenantNotificationSettings.findUnique.mockResolvedValue({ mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] });
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'w1', send: (e) => received.push(e) });
        await createWatcherNotifications(db as never, ['w1'], activity());
        expect(received).toHaveLength(0);
    });

    it('SKIPS the bus publish when skipDuplicates collapses all inserts', async () => {
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'w1', send: (e) => received.push(e) });

        createManyMock.mockResolvedValueOnce({ count: 0 });
        await createWatcherNotifications(db as never, ['w1'], activity());

        expect(received).toHaveLength(0);
    });
});
