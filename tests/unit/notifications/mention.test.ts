/**
 * The mention bell (sub-phase 2.7d; owner decisions 128 and 130): one row per
 * person, who mentioned them on which item and a link, never the text; the
 * person's preference asked before the write, in one batch; the SSE event
 * carries the row's real id. And the email builder says the same, never more.
 */
import { buildMentionDedupeKey, createMentionNotifications, mentionBody, type MentionNotificationTarget } from '@/app-layer/notifications/mention';
import { buildWorkItemMentionedEmail } from '@/app-layer/notifications/templates';
import { __resetNotificationBusForTests, subscribeToNotifications, type NotificationEvent } from '@/lib/notifications/notification-bus';

function target(overrides: Partial<MentionNotificationTarget> = {}): MentionNotificationTarget {
    return {
        tenantId: 'tenant-1',
        workItemId: 'wi-1',
        workItemKey: 'ISL-42',
        workItemTitle: 'Patch the firewall',
        linkUrl: '/t/acme/work-items/wi-1',
        commentId: 'c-1',
        mentionedByName: 'Ada Lovelace',
        ...overrides,
    };
}

function fakeDb() {
    return {
        notification: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn(async ({ where }: { where: { dedupeKey: { in: string[] } } }) =>
                where.dedupeKey.in.map((dedupeKey, i) => ({ id: `row-${i + 1}`, dedupeKey, createdAt: new Date('2026-12-05T09:00:00Z') })),
            ),
        },
        tenantNotificationSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        notificationPreference: { findMany: jest.fn().mockResolvedValue([]) },
    };
}

describe('mentionBody', () => {
    it('names who, where and which item; never any text of the comment or description', () => {
        expect(mentionBody(target())).toBe('Ada Lovelace mentioned you in a comment on ISL-42 "Patch the firewall".');
        expect(mentionBody(target({ commentId: null, mentionedByName: null }))).toBe('Someone mentioned you in the description of ISL-42 "Patch the firewall".');
    });

    it('keys per source, person and day', () => {
        const now = new Date('2026-12-05T10:00:00Z');
        expect(buildMentionDedupeKey(target(), 'u1', now)).toBe('tenant-1:WORK_ITEM_MENTIONED:wi-1:c-1:u1:2026-12-05');
        expect(buildMentionDedupeKey(target({ commentId: null }), 'u1', now)).toBe('tenant-1:WORK_ITEM_MENTIONED:wi-1:description:u1:2026-12-05');
    });
});

describe('createMentionNotifications', () => {
    beforeEach(() => __resetNotificationBusForTests());

    it('writes one WORK_ITEM_MENTIONED row per person, with the item and its link', async () => {
        const db = fakeDb();
        db.notification.createMany.mockResolvedValue({ count: 2 });
        await createMentionNotifications(db as never, ['u1', 'u2', 'u1'], target());
        const args = db.notification.createMany.mock.calls[0][0];
        expect(args.skipDuplicates).toBe(true);
        expect(args.data.map((r: { userId: string }) => r.userId)).toEqual(['u1', 'u2']);
        for (const row of args.data) {
            expect(row).toMatchObject({ type: 'WORK_ITEM_MENTIONED', title: 'You were mentioned', linkUrl: '/t/acme/work-items/wi-1', workItemId: 'wi-1' });
        }
    });

    it('leaves out a person who switched mentions off, and a muted workspace writes nothing, in one batch read', async () => {
        const db = fakeDb();
        db.notificationPreference.findMany.mockResolvedValue([{ userId: 'u2', inApp: false, emailDelivery: 'OFF' }]);
        await createMentionNotifications(db as never, ['u1', 'u2'], target());
        expect(db.notificationPreference.findMany).toHaveBeenCalledTimes(1);
        expect(db.notification.createMany.mock.calls[0][0].data.map((r: { userId: string }) => r.userId)).toEqual(['u1']);

        const muted = fakeDb();
        muted.tenantNotificationSettings.findUnique.mockResolvedValue({ mutedInAppTypes: ['WORK_ITEM_MENTIONED'] });
        expect(await createMentionNotifications(muted as never, ['u1'], target())).toEqual({ created: 0 });
        expect(muted.notification.createMany).not.toHaveBeenCalled();
    });

    it('publishes the inserted row with its real id', async () => {
        const db = fakeDb();
        const received: NotificationEvent[] = [];
        subscribeToNotifications({ tenantId: 'tenant-1', userId: 'u1', send: (e) => received.push(e) });
        await createMentionNotifications(db as never, ['u1'], target());
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ id: 'row-1', type: 'WORK_ITEM_MENTIONED', read: false });
    });
});

describe('the mention email', () => {
    it('says who, where and which item, links to it, and carries no text', async () => {
        const email = await buildWorkItemMentionedEmail({
            recipientName: 'Bob',
            mentionedByName: 'Ada Lovelace',
            where: 'comment',
            workItemTitle: 'Patch the firewall',
            workItemKey: 'ISL-42',
            linkPath: '/t/acme/work-items/wi-1',
        });
        expect(email.subject).toBe('Mentioned on [ISL-42] Patch the firewall');
        expect(email.bodyText).toContain('Ada Lovelace mentioned you in a comment on a work item:');
        expect(email.bodyText).toMatch(/\/t\/acme\/work-items\/wi-1$/m);
        expect(email.bodyHtml).toContain('You were mentioned');
    });
});
