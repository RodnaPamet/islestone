/**
 * The review bells and emails (sub-phase 2.8a; owner decision 161): what
 * they say (who, which item, which step; never the response text, decision
 * 157), how they dedupe, and the preferences they are offered.
 */
import { buildReviewDedupeKey, createReviewNotifications, reviewNotificationText, type ReviewNotice } from '@/app-layer/notifications/review';
import { buildWorkItemReviewEmail } from '@/app-layer/notifications/templates';
import { IMMEDIATE_EMAIL_TYPES, PREFERENCE_DEFAULTS, PREFERENCE_TYPES, choiceRefusal } from '@/lib/notifications/preferences';

jest.mock('@/lib/notifications/notification-bus', () => ({ publishNotificationEvent: jest.fn() }));

const target = { tenantId: 't1', workItemId: 'w1', workItemKey: 'ISL-7', workItemTitle: 'Ship it', linkUrl: '/t/acme/work-items/w1' };

describe('review notification text', () => {
    const notices: ReviewNotice[] = [
        { kind: 'requested', stepId: 's1', stepName: 'Legal', requestedByName: 'Ada' },
        { kind: 'stalled', stepId: 's1', stepName: 'Legal' },
        { kind: 'due', stepId: 's1', stepName: 'Legal', window: 'overdue' },
        { kind: 'returned', stepId: 's1', stepName: 'Legal', roundNumber: 2, byName: 'Rae' },
        { kind: 'completed', roundId: 'r1', roundNumber: 2 },
    ];

    it.each(notices)('names the item for a %o notice', (notice) => {
        const { title, body } = reviewNotificationText(target, notice);
        expect(title.length).toBeGreaterThan(0);
        expect(body).toContain('ISL-7 "Ship it"');
    });

    it('says who and which step', () => {
        expect(reviewNotificationText(target, notices[0]!).body).toBe('Ada asks you to review ISL-7 "Ship it" (step "Legal").');
        expect(reviewNotificationText(target, notices[3]!).body).toBe('Rae returned ISL-7 "Ship it" at the review step "Legal".');
        expect(reviewNotificationText(target, notices[2]!).body).toContain('is overdue');
    });

    it('dedupes per step and person (per window for reminders, per round for a completion)', () => {
        expect(buildReviewDedupeKey('t1', notices[0]!, 'u1')).toBe('t1:WORK_ITEM_REVIEW_REQUESTED:s1:u1');
        expect(buildReviewDedupeKey('t1', notices[1]!, 'u1')).toBe('t1:WORK_ITEM_REVIEW_REQUESTED:stalled:s1:u1');
        expect(buildReviewDedupeKey('t1', notices[2]!, 'u1')).toBe('t1:WORK_ITEM_REVIEW_DUE:overdue:s1:u1');
        expect(buildReviewDedupeKey('t1', notices[4]!, 'u1')).toBe('t1:WORK_ITEM_REVIEW_COMPLETED:r1:u1');
    });

    it('asks the preference before it writes, and writes only for the people it admits', async () => {
        const order: string[] = [];
        const db = {
            tenantNotificationSettings: { findUnique: jest.fn(async () => { order.push('settings'); return null; }) },
            notificationPreference: {
                findMany: jest.fn(async () => {
                    order.push('preferences');
                    return [{ userId: 'u2', type: 'WORK_ITEM_REVIEW_REQUESTED', inApp: false, emailDelivery: 'OFF' }];
                }),
            },
            notification: {
                createMany: jest.fn(async (args: { data: Array<{ userId: string }> }) => {
                    order.push('write');
                    return { count: args.data.length };
                }),
                findMany: jest.fn(async () => []),
            },
        };
        await createReviewNotifications(db as never, ['u1', 'u2', 'u1'], target, notices[0]!);
        expect(order.indexOf('write')).toBeGreaterThan(order.indexOf('preferences'));
        const written = (db.notification.createMany.mock.calls[0] as unknown as [{ data: Array<{ userId: string; workItemId: string }> }])[0].data;
        expect(written.map((r) => r.userId)).toEqual(['u1']);
        expect(written[0]!.workItemId).toBe('w1');
    });
});

describe('the review emails', () => {
    it('say who, which item and which step, and link to the item', async () => {
        const email = await buildWorkItemReviewEmail('RETURNED', {
            recipientName: 'Mia',
            actorName: 'Rae',
            stepName: 'Legal',
            workItemTitle: 'Ship it',
            workItemKey: 'ISL-7',
            linkPath: '/t/acme/work-items/w1',
        });
        expect(email.subject).toBe('A work item was returned: [ISL-7] Ship it');
        expect(email.bodyText).toContain('Rae returned a work item at the review step "Legal":');
        expect(email.bodyText).toContain('Open the work item: ');
        expect(email.bodyText).toContain('/t/acme/work-items/w1');
    });
});

describe('the review preferences (decision 161)', () => {
    it('offers the four types, immediate email for requested and returned only', () => {
        for (const t of ['WORK_ITEM_REVIEW_REQUESTED', 'WORK_ITEM_REVIEW_DUE', 'WORK_ITEM_REVIEW_RETURNED', 'WORK_ITEM_REVIEW_COMPLETED'] as const) {
            expect(PREFERENCE_TYPES).toContain(t);
        }
        expect(IMMEDIATE_EMAIL_TYPES).toEqual(expect.arrayContaining(['WORK_ITEM_REVIEW_REQUESTED', 'WORK_ITEM_REVIEW_RETURNED']));
        expect(IMMEDIATE_EMAIL_TYPES).not.toContain('WORK_ITEM_REVIEW_DUE');
        expect(choiceRefusal('WORK_ITEM_REVIEW_COMPLETED', { inApp: true, email: 'IMMEDIATE' })).toBe('IMMEDIATE_NOT_OFFERED');
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_REVIEW_REQUESTED).toEqual({ inApp: true, email: 'IMMEDIATE' });
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_REVIEW_RETURNED).toEqual({ inApp: true, email: 'IMMEDIATE' });
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_REVIEW_DUE).toEqual({ inApp: true, email: 'DAILY' });
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_REVIEW_COMPLETED).toEqual({ inApp: true, email: 'OFF' });
    });
});
