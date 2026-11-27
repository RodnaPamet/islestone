/**
 * The preference resolution (sub-phase 2.7c; owner decision 132), pure and
 * exhaustive: every notification type has a default; the grid's types are
 * exactly the types a bell writer emits; immediate email only where offered;
 * the workspace's settings only narrow a member's choice; the daily digest
 * needs the bell except for due dates; and the refusals the usecase gives.
 */
import { NotificationType } from '@prisma/client';

import { listInAppNotificationTypes } from '@/app-layer/notifications/in-app-types';
import { dueGroup } from '@/app-layer/jobs/notification-digest';
import {
    choiceRefusal,
    EMAIL_DELIVERIES,
    emailChoicesFor,
    IMMEDIATE_EMAIL_TYPES,
    IN_APP_ONLY_TYPES,
    PREFERENCE_DEFAULTS,
    PREFERENCE_TYPES,
    resolveDelivery,
    type PreferenceCeiling,
} from '@/lib/notifications/preferences';

const OPEN: PreferenceCeiling = { emailEnabled: true, mutedInAppTypes: [] };

describe('preference defaults and types', () => {
    it('every NotificationType has a default, and the bell is on for each', () => {
        for (const type of Object.values(NotificationType)) {
            expect(PREFERENCE_DEFAULTS[type]).toBeDefined();
            expect(PREFERENCE_DEFAULTS[type].inApp).toBe(true);
        }
    });

    it('the grid lists exactly the types a bell writer emits', () => {
        expect([...PREFERENCE_TYPES].sort()).toEqual(listInAppNotificationTypes().map((e) => e.type).sort());
    });

    it('defaults: at once for the direct types, daily for due and watched, off for intake (the map\'s table)', () => {
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_ASSIGNED.email).toBe('IMMEDIATE');
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_WAITING_ON.email).toBe('IMMEDIATE');
        // Mentions (2.7d): at once by default, and offered at once (decision 132).
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_MENTIONED).toEqual({ inApp: true, email: 'IMMEDIATE' });
        expect(IMMEDIATE_EMAIL_TYPES as readonly string[]).toContain('WORK_ITEM_MENTIONED');
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_DUE.email).toBe('DAILY');
        expect(PREFERENCE_DEFAULTS.WORK_ITEM_WATCH_UPDATE.email).toBe('DAILY');
        expect(PREFERENCE_DEFAULTS.INTAKE_REQUEST_RECEIVED.email).toBe('OFF');
        expect(PREFERENCE_DEFAULTS.INTAKE_REQUEST_WOKEN.email).toBe('OFF');
    });

    it('no default is louder than its type allows', () => {
        for (const type of Object.values(NotificationType)) {
            if (PREFERENCE_DEFAULTS[type].email === 'IMMEDIATE') expect(IMMEDIATE_EMAIL_TYPES as readonly string[]).toContain(type);
            if ((IN_APP_ONLY_TYPES as readonly string[]).includes(type)) expect(PREFERENCE_DEFAULTS[type].email).toBe('OFF');
        }
    });

    it('a calendar change not applied is in the bell only (3.3c, decision 230): offered OFF alone, never mailed', () => {
        expect(IN_APP_ONLY_TYPES).toEqual(['CALENDAR_CHANGE_NOT_APPLIED', 'TIME_OFF_CHANGED_BY_OTHER']);
        expect(PREFERENCE_DEFAULTS.TIME_OFF_CHANGED_BY_OTHER).toEqual({ inApp: true, email: 'OFF' });
        expect(PREFERENCE_DEFAULTS.CALENDAR_CHANGE_NOT_APPLIED).toEqual({ inApp: true, email: 'OFF' });
        expect(emailChoicesFor('CALENDAR_CHANGE_NOT_APPLIED')).toEqual(['OFF']);
        expect(emailChoicesFor('WORK_ITEM_ASSIGNED')).toEqual(['OFF', 'IMMEDIATE', 'DAILY']);
        expect(emailChoicesFor('WORK_ITEM_DUE')).toEqual(['OFF', 'DAILY']);
        for (const email of EMAIL_DELIVERIES) {
            expect(resolveDelivery('CALENDAR_CHANGE_NOT_APPLIED', { inApp: true, emailDelivery: email }, OPEN).email).toBe('OFF');
        }
    });
});

describe('resolveDelivery', () => {
    it('with no row and no ceiling, is the default', () => {
        for (const type of PREFERENCE_TYPES) {
            const r = resolveDelivery(type, null, OPEN);
            expect(r).toMatchObject({ isDefault: true, inApp: true, email: PREFERENCE_DEFAULTS[type].email, inAppCap: null, emailCap: null });
        }
    });

    it("the workspace only narrows: a mute turns the bell off, a switched-off email turns every email off, whatever the member chose", () => {
        for (const type of PREFERENCE_TYPES) {
            for (const email of EMAIL_DELIVERIES) {
                for (const inApp of [true, false]) {
                    const stored = { inApp, emailDelivery: email };
                    const free = resolveDelivery(type, stored, OPEN);
                    const muted = resolveDelivery(type, stored, { emailEnabled: true, mutedInAppTypes: [type] });
                    const noMail = resolveDelivery(type, stored, { emailEnabled: false, mutedInAppTypes: [] });
                    expect(muted.inApp).toBe(false);
                    expect(noMail.email).toBe('OFF');
                    // Never louder than the member's own resolution.
                    if (!free.inApp) expect(muted.inApp).toBe(false);
                    if (free.email === 'OFF') expect([muted.email, noMail.email]).toEqual(['OFF', 'OFF']);
                }
            }
        }
    });

    it('names the cap: the workspace mute, the workspace email switch, the bell off for a daily digest', () => {
        expect(resolveDelivery('WORK_ITEM_WATCH_UPDATE', null, { emailEnabled: true, mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE'] })).toMatchObject({
            inAppCap: 'WORKSPACE_MUTED',
            email: 'OFF',
            emailCap: 'WORKSPACE_MUTED',
        });
        expect(resolveDelivery('WORK_ITEM_ASSIGNED', null, { emailEnabled: false, mutedInAppTypes: [] })).toMatchObject({ email: 'OFF', emailCap: 'WORKSPACE_EMAIL_OFF' });
        expect(resolveDelivery('WORK_ITEM_WATCH_UPDATE', { inApp: false, emailDelivery: 'DAILY' }, OPEN)).toMatchObject({ email: 'OFF', emailCap: 'BELL_OFF' });
    });

    it('due dates are read from the items, so their daily email works with the bell off', () => {
        expect(resolveDelivery('WORK_ITEM_DUE', { inApp: false, emailDelivery: 'DAILY' }, OPEN)).toMatchObject({ inApp: false, email: 'DAILY', emailCap: null });
    });

    it('a stored IMMEDIATE for a type that does not offer it reads as DAILY, never louder and never silent', () => {
        expect(resolveDelivery('WORK_ITEM_DUE', { inApp: true, emailDelivery: 'IMMEDIATE' }, OPEN).email).toBe('DAILY');
    });
});

describe('choiceRefusal', () => {
    it('refuses immediate email where it is not offered, and a daily digest of a kind with the bell off', () => {
        expect(choiceRefusal('WORK_ITEM_WATCH_UPDATE', { inApp: true, email: 'IMMEDIATE' })).toBe('IMMEDIATE_NOT_OFFERED');
        expect(choiceRefusal('WORK_ITEM_WATCH_UPDATE', { inApp: false, email: 'DAILY' })).toBe('DAILY_NEEDS_IN_APP');
        expect(choiceRefusal('WORK_ITEM_DUE', { inApp: false, email: 'DAILY' })).toBeNull();
        expect(choiceRefusal('WORK_ITEM_ASSIGNED', { inApp: false, email: 'IMMEDIATE' })).toBeNull();
    });

    it('refuses any email for an in-app-only kind', () => {
        expect(choiceRefusal('CALENDAR_CHANGE_NOT_APPLIED', { inApp: true, email: 'DAILY' })).toBe('EMAIL_NOT_OFFERED');
        expect(choiceRefusal('CALENDAR_CHANGE_NOT_APPLIED', { inApp: true, email: 'IMMEDIATE' })).toBe('EMAIL_NOT_OFFERED');
        expect(choiceRefusal('CALENDAR_CHANGE_NOT_APPLIED', { inApp: false, email: 'OFF' })).toBeNull();
    });
});

describe('the digest groups due dates from today', () => {
    const today = new Date('2030-03-10T00:00:00Z');
    it('overdue, today, soon', () => {
        expect(dueGroup(new Date('2030-03-09T00:00:00Z'), today)).toBe('OVERDUE');
        expect(dueGroup(new Date('2030-03-10T00:00:00Z'), today)).toBe('TODAY');
        expect(dueGroup(new Date('2030-03-11T00:00:00Z'), today)).toBe('SOON');
    });
});
