/**
 * Branch coverage for the email-provider abstraction.
 *
 * `mailer.ts` is a small provider-strategy module with a mutable
 * module-level singleton. The branches worth pinning:
 *
 *   - the singleton get/set/sendEmail delegation
 *   - StubEmailProvider record + reset
 *   - initMailerFromEnv: no SMTP transport is installed (nodemailer awaits a
 *     licence decision), so it keeps the console sink either way, and says
 *     so — an error when SMTP_HOST is set, a warning in production without it.
 *   - no log line carries a recipient's address (or the body, which greets
 *     them by name): the console sink logs `hashForLookup` of each address and
 *     the template (owner decision, 2026-11-19).
 *
 * Copied from inflect-compliance `tests/unit/mailer.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, without the NodemailerProvider
 * cases (no transport is ported) and with Islestone's reserved domain.
 */
jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { logger } from '@/lib/observability/logger';
import {
    ConsoleEmailProvider,
    StubEmailProvider,
    getEmailProvider,
    setEmailProvider,
    sendEmail,
    isUndeliverableRecipient,
    initMailerFromEnv,
    recipientLogFields,
    type EmailMessage,
} from '@/lib/mailer';
import { hashForLookup } from '@/lib/security/encryption';
import { tenantSystemUserEmail } from '@/lib/tenant-system-user';

const BASE_MSG: EmailMessage = {
    to: 'user@example.com',
    subject: 'Hello',
    text: 'plain body',
};

beforeEach(() => {
    jest.clearAllMocks();
    // Reset the module singleton between tests.
    setEmailProvider(new ConsoleEmailProvider());
});

describe('StubEmailProvider', () => {
    it('records every sent message', async () => {
        const stub = new StubEmailProvider();
        await stub.send(BASE_MSG);
        await stub.send({ ...BASE_MSG, subject: 'Second' });

        expect(stub.sentMessages).toHaveLength(2);
        expect(stub.sentMessages[1].subject).toBe('Second');
    });

    it('clears recorded messages on reset()', async () => {
        const stub = new StubEmailProvider();
        await stub.send(BASE_MSG);
        stub.reset();
        expect(stub.sentMessages).toHaveLength(0);
    });
});

describe('provider singleton', () => {
    it('defaults to a ConsoleEmailProvider', () => {
        expect(getEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
    });

    it('setEmailProvider swaps the active provider', () => {
        const stub = new StubEmailProvider();
        setEmailProvider(stub);
        expect(getEmailProvider()).toBe(stub);
    });

    it('sendEmail delegates to the active provider', async () => {
        const stub = new StubEmailProvider();
        setEmailProvider(stub);

        await sendEmail(BASE_MSG);

        expect(stub.sentMessages).toEqual([BASE_MSG]);
    });

    it("sendEmail sends nothing to a tenant's SYSTEM user, whose address is undeliverable (#4400)", async () => {
        const stub = new StubEmailProvider();
        setEmailProvider(stub);

        await expect(
            sendEmail({ ...BASE_MSG, to: tenantSystemUserEmail('tenant-1') }),
        ).resolves.toEqual({ delivered: false });
        expect(stub.sentMessages).toEqual([]);

        // Only a list made ENTIRELY of reserved addresses is dropped.
        expect(isUndeliverableRecipient(`a@example.com, ${tenantSystemUserEmail('t')}`)).toBe(false);
        expect(isUndeliverableRecipient('Islestone <system+t@islestone.invalid>')).toBe(true);
        expect(isUndeliverableRecipient('someone@invalid.example.com')).toBe(false);
    });

    it('sendEmail reports a configured transport as delivered', async () => {
        setEmailProvider(new StubEmailProvider());
        await expect(sendEmail(BASE_MSG)).resolves.toEqual({ delivered: true });
    });

    it('sendEmail reports the console sink as NOT delivered — it only logs the message', async () => {
        await expect(sendEmail(BASE_MSG)).resolves.toEqual({ delivered: false });
        expect(getEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
    });

    it('ConsoleEmailProvider.send resolves without throwing', async () => {
        await expect(
            new ConsoleEmailProvider().send(BASE_MSG),
        ).resolves.toBeUndefined();
    });
});

describe('the console sink never logs a recipient address', () => {
    const MSG: EmailMessage = {
        to: 'Dana.Lee@Example.com, second@example.org',
        bcc: 'audit-copy@example.net',
        subject: 'Assigned to you: [ISL-1] Patch',
        text: 'Hi Dana Lee, you were assigned a work item.',
        template: 'WORK_ITEM_ASSIGNED',
    };
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
    const ORIGINAL_KEY = process.env.DATA_ENCRYPTION_KEY;
    afterEach(() => {
        (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
        if (ORIGINAL_KEY === undefined) delete process.env.DATA_ENCRYPTION_KEY;
        else process.env.DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
    });

    /** Every argument of every logger call, serialised, so a nested field cannot hide an address. */
    function logged(): string {
        const calls = (['info', 'warn', 'error', 'debug'] as const).flatMap(
            (level) => (logger[level] as unknown as jest.Mock).mock.calls,
        );
        expect(calls.length).toBeGreaterThan(0);
        return JSON.stringify(calls);
    }

    it.each(['production', 'development'])('in %s: hashes and template, never the address or the body', async (nodeEnv) => {
        (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
        // Production refuses the published fallback key; a throwaway test value.
        process.env.DATA_ENCRYPTION_KEY = 'mailer-test-key-not-a-real-secret-000000001'; // pragma: allowlist secret
        await sendEmail(MSG);
        const out = logged();
        for (const address of ['Dana.Lee@Example.com', 'dana.lee@example.com', 'second@example.org', 'audit-copy@example.net']) {
            expect(out.toLowerCase()).not.toContain(address.toLowerCase());
        }
        expect(out).not.toContain('Hi Dana Lee');
        expect(out).toContain(hashForLookup('dana.lee@example.com'));
        expect(out).toContain(hashForLookup('second@example.org'));
        expect(out).toContain(hashForLookup('audit-copy@example.net'));
        expect(out).toContain('WORK_ITEM_ASSIGNED');
    });

    it('recipientLogFields hashes every listed address the way a lookup does (trimmed, lower-cased)', () => {
        expect(recipientLogFields({ to: ' A@B.example , c@d.example', template: 'DUE_DIGEST' })).toEqual({
            recipientHashes: [hashForLookup('a@b.example'), hashForLookup('c@d.example')],
            template: 'DUE_DIGEST',
        });
    });
});

describe('initMailerFromEnv', () => {
    const ORIGINAL = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL };
        setEmailProvider(new ConsoleEmailProvider());
    });

    it('keeps the console provider when SMTP_HOST is unset', () => {
        delete process.env.SMTP_HOST;
        initMailerFromEnv();
        expect(getEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
    });

    it('says so loudly when SMTP_HOST is set, and keeps the console sink (no transport is installed)', () => {
        process.env.SMTP_HOST = 'smtp.configured';
        initMailerFromEnv();
        expect(getEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('no SMTP transport is installed'),
            expect.objectContaining({ host: 'smtp.configured' }),
        );
    });

    it('warns in production when SMTP_HOST is unset — no email will be delivered', () => {
        delete process.env.SMTP_HOST;
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        initMailerFromEnv();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SMTP_HOST unset'), expect.anything());
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('is silent in development without SMTP_HOST', () => {
        delete process.env.SMTP_HOST;
        (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
        initMailerFromEnv();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
