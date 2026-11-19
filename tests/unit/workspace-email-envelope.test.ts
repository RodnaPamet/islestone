/**
 * The workspace's own email carries its sender and BCC mailbox, and stops
 * when the workspace switches email notifications off (inflect #4469).
 *
 * `tenantEmailEnvelope` and `resolveTenantEmailEnvelope` are the one
 * definition every sender of workspace email reads (today the outbox, which
 * carries the digest too).
 *
 * Copied from inflect-compliance `tests/unit/workspace-email-envelope.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, the envelope half only (the
 * compliance-digest half is not ported), with `bccMailbox` and neutral names.
 */
import {
    resolveTenantEmailEnvelope,
    tenantEmailEnvelope,
} from '@/app-layer/notifications/settings';
import { UNCONFIGURED_SENDER, deploymentSenderAddress } from '@/lib/email/sender-identity';

type Db = Parameters<typeof resolveTenantEmailEnvelope>[0];

const SETTINGS_ON = {
    enabled: true,
    defaultFromName: 'Acme Ops',
    defaultFromEmail: 'ops@acme.test',
    bccMailbox: 'archive@acme.test',
    mutedInAppTypes: [],
};

describe('tenantEmailEnvelope — the one definition', () => {
    it('formats the sender and carries the BCC mailbox as BCC', () => {
        expect(tenantEmailEnvelope(SETTINGS_ON)).toEqual({
            from: 'Acme Ops <ops@acme.test>',
            bcc: 'archive@acme.test',
        });
    });

    it('carries no BCC when no BCC mailbox is set', () => {
        expect(tenantEmailEnvelope({ ...SETTINGS_ON, bccMailbox: null }).bcc).toBeUndefined();
        expect(tenantEmailEnvelope({ ...SETTINGS_ON, bccMailbox: '' }).bcc).toBeUndefined();
    });
});

describe('resolveTenantEmailEnvelope', () => {
    const dbWith = (row: unknown): Db =>
        ({ tenantNotificationSettings: { findUnique: async () => row } }) as unknown as Db;

    it('is null when the workspace has switched email off', async () => {
        expect(await resolveTenantEmailEnvelope(dbWith({ ...SETTINGS_ON, enabled: false }), 't1')).toBeNull();
    });

    it('is the workspace envelope when email is on', async () => {
        expect(await resolveTenantEmailEnvelope(dbWith(SETTINGS_ON), 't1')).toEqual({
            from: 'Acme Ops <ops@acme.test>',
            bcc: 'archive@acme.test',
        });
    });

    it('a workspace with no settings row sends, from the deployment sender, uncopied', async () => {
        const original = process.env.SMTP_FROM;
        process.env.SMTP_FROM = 'ops@example-verified.test';
        try {
            const envelope = await resolveTenantEmailEnvelope(dbWith(null), 't1');
            expect(envelope).toEqual({
                from: `Islestone <${deploymentSenderAddress()}>`,
                bcc: undefined,
            });
            expect(envelope?.from).not.toContain(UNCONFIGURED_SENDER);
        } finally {
            if (original === undefined) delete process.env.SMTP_FROM;
            else process.env.SMTP_FROM = original;
        }
    });

    it('a failed read throws rather than defaulting to "send"', async () => {
        const db = {
            tenantNotificationSettings: { findUnique: async () => { throw new Error('db down'); } },
        } as unknown as Db;
        await expect(resolveTenantEmailEnvelope(db, 't1')).rejects.toThrow('db down');
    });
});
