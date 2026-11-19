/**
 * A change to the workspace's notification settings is audited (#4469).
 *
 * `updateTenantNotificationSettings` upserted with no `logEvent`, so switching
 * email off — or pointing the BCC copy of every outbox email at a
 * new address — left nothing in the audit log. It now writes one
 * NOTIFICATION_SETTINGS_UPDATED row naming the changed fields with their
 * before/after values, and nothing for a save that changes nothing.
 *
 * The row's `detailsJson` is fed to the REAL validator: `logEvent` throws on a
 * shape it refuses, inside the caller's transaction, so a bad shape would roll
 * the settings write back and 400 a valid save.
 */
const logEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('@/app-layer/events/audit', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { updateTenantNotificationSettings } from '@/app-layer/notifications/settings';
import { validateAuditDetailsJson } from '@/app-layer/schemas/json-columns.schemas';
import { makeRequestContext } from '../helpers/make-context';

type Db = Parameters<typeof updateTenantNotificationSettings>[0];
type Row = {
    enabled: boolean;
    defaultFromName: string;
    defaultFromEmail: string;
    bccMailbox: string | null;
    mutedInAppTypes: string[] | null;
};

const STORED: Row = {
    enabled: true,
    defaultFromName: 'Acme GRC',
    defaultFromEmail: 'grc@acme.test',
    bccMailbox: null,
    mutedInAppTypes: ['WORK_ITEM_ASSIGNED', 'WORK_ITEM_WATCH_UPDATE'],
};

/** A settings table holding `stored`; the upsert applies the update to it. */
function dbHolding(stored: Row | null): Db {
    return {
        tenantNotificationSettings: {
            findUnique: async () => stored,
            upsert: async (args: { create: Row; update: Partial<Row> }) =>
                stored ? { ...stored, ...args.update } : { ...args.create },
        },
    } as unknown as Db;
}

const ctx = makeRequestContext('ADMIN');

type AuditPayload = {
    action: string;
    entityType: string;
    entityId: string;
    detailsJson: { changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown> };
};
const payload = () => logEvent.mock.calls[0][2] as AuditPayload;

beforeEach(() => jest.clearAllMocks());

describe('updateTenantNotificationSettings audit', () => {
    it('records switching email off and a new BCC address, with before and after', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, {
            enabled: false,
            bccMailbox: 'archive@elsewhere.test',
        });

        expect(logEvent).toHaveBeenCalledTimes(1);
        const p = payload();
        expect(p).toMatchObject({
            action: 'NOTIFICATION_SETTINGS_UPDATED',
            entityType: 'TenantNotificationSettings',
            entityId: ctx.tenantId,
        });
        expect(p.detailsJson.changedFields.sort()).toEqual(['bccMailbox', 'enabled']);
        expect(p.detailsJson.before).toEqual({ enabled: true, bccMailbox: null });
        expect(p.detailsJson.after).toEqual({ enabled: false, bccMailbox: 'archive@elsewhere.test' });
        // Unchanged fields are not in the summary.
        expect(p.detailsJson.before).not.toHaveProperty('defaultFromEmail');
    });

    it('the row passes the real audit-details validator', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, { defaultFromName: 'Acme Security' });
        expect(() => validateAuditDetailsJson(payload().detailsJson)).not.toThrow();
    });

    it('records a sender change', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, { defaultFromEmail: 'security@acme.test' });
        expect(payload().detailsJson.before).toEqual({ defaultFromEmail: 'grc@acme.test' });
        expect(payload().detailsJson.after).toEqual({ defaultFromEmail: 'security@acme.test' });
    });

    it('writes nothing for a save that changes nothing', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, {
            enabled: true,
            defaultFromName: 'Acme GRC',
            bccMailbox: null,
        });
        expect(logEvent).not.toHaveBeenCalled();
    });

    it('a re-ordered mute list is not a change', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, {
            mutedInAppTypes: ['WORK_ITEM_WATCH_UPDATE', 'WORK_ITEM_ASSIGNED'],
        });
        expect(logEvent).not.toHaveBeenCalled();
    });

    it('a muted type is a change', async () => {
        await updateTenantNotificationSettings(dbHolding(STORED), ctx, {
            mutedInAppTypes: ['WORK_ITEM_ASSIGNED'],
        });
        expect(payload().detailsJson.changedFields).toEqual(['mutedInAppTypes']);
    });

    it('a first save measures the change against the defaults the workspace was sending under', async () => {
        await updateTenantNotificationSettings(dbHolding(null), ctx, { enabled: false });
        expect(payload().detailsJson.changedFields).toEqual(['enabled']);
        expect(payload().detailsJson.before).toEqual({ enabled: true });
        expect(payload().detailsJson.after).toEqual({ enabled: false });
    });
});
