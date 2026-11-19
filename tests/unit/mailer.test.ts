/**
 * Branch coverage for the email-provider abstraction.
 *
 * `mailer.ts` is a small provider-strategy module with a mutable
 * module-level singleton. The branches worth pinning:
 *
 *   - the singleton get/set/sendEmail delegation, and the lazy init on the
 *     first send of a module copy nothing initialised
 *   - StubEmailProvider record + reset
 *   - NodemailerProvider's conditional `auth` / `secure` / `html` /
 *     `bcc` / `from`-override spreads (each is an `&&` branch)
 *   - initMailerFromEnv: SMTP_HOST set → swap to Nodemailer (credentials
 *     never logged); unset → keep the console sink, and warn in production
 *   - no log line carries a recipient's address (or the body, which greets
 *     them by name): the console sink logs `hashForLookup` of each address and
 *     the template (owner decision, 2026-11-19).
 *
 * nodemailer is mocked so no real transport is constructed; the test asserts
 * the exact config object handed to createTransport.
 *
 * Copied from inflect-compliance `tests/unit/mailer.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with Islestone's reserved domain,
 * the env read through the `@/env` mock, and the logging, lazy-init and
 * credential cases added.
 */
const createTransportMock = jest.fn();
const sendMailMock = jest.fn().mockResolvedValue(undefined);

jest.mock('nodemailer', () => ({
    __esModule: true,
    default: {
        createTransport: (...args: unknown[]) => {
            createTransportMock(...args);
            return { sendMail: sendMailMock };
        },
    },
}));
jest.mock('@/lib/observability/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { logger } from '@/lib/observability/logger';
import {
    ConsoleEmailProvider,
    NodemailerProvider,
    StubEmailProvider,
    _resetMailerForTesting,
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
    // Reset the module singleton (and its lazy-init latch) between tests.
    _resetMailerForTesting();
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

describe('NodemailerProvider', () => {
    it('builds an auth block only when user + pass are present', () => {
        new NodemailerProvider({ host: 'smtp.test', port: 587, user: 'u', pass: 'p', from: 'noreply@test' });
        expect(createTransportMock).toHaveBeenCalledWith({
            host: 'smtp.test',
            port: 587,
            secure: false, // 587 ≠ 465
            auth: { user: 'u', pass: 'p' },
        });
    });

    it('omits the auth block when credentials are missing', () => {
        new NodemailerProvider({ host: 'smtp.test', port: 25, from: 'noreply@test' });
        expect(createTransportMock).toHaveBeenCalledWith({ host: 'smtp.test', port: 25, secure: false });
    });

    it('sets secure:true for the implicit-TLS port 465', () => {
        new NodemailerProvider({ host: 'smtp.test', port: 465, from: 'noreply@test' });
        expect(createTransportMock.mock.calls[0][0].secure).toBe(true);
    });

    it('send() uses the configured default sender and minimal fields', async () => {
        await new NodemailerProvider({ host: 'smtp.test', port: 587, from: 'default@test' }).send(BASE_MSG);
        expect(sendMailMock).toHaveBeenCalledWith({
            from: 'default@test',
            to: BASE_MSG.to,
            subject: BASE_MSG.subject,
            text: BASE_MSG.text,
        });
    });

    it('send() honours per-message from override, html and the BCC mailbox', async () => {
        await new NodemailerProvider({ host: 'smtp.test', port: 587, from: 'default@test' }).send({
            ...BASE_MSG,
            from: 'override@test',
            html: '<p>rich</p>',
            bcc: 'copy@test',
        });
        expect(sendMailMock).toHaveBeenCalledWith({
            from: 'override@test',
            to: BASE_MSG.to,
            subject: BASE_MSG.subject,
            text: BASE_MSG.text,
            html: '<p>rich</p>',
            bcc: 'copy@test',
        });
    });

    it('sendEmail through the transport reports delivered, and logs nothing about the recipient', async () => {
        setEmailProvider(new NodemailerProvider({ host: 'smtp.test', port: 587, from: 'default@test' }));
        await expect(sendEmail({ ...BASE_MSG, to: 'person@example.org' })).resolves.toEqual({ delivered: true });
        expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'person@example.org' }));
        const calls = (['info', 'warn', 'error', 'debug'] as const).flatMap(
            (level) => (logger[level] as unknown as jest.Mock).mock.calls,
        );
        expect(JSON.stringify(calls)).not.toContain('person@example.org');
    });
});

describe('initMailerFromEnv', () => {
    const ORIGINAL = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL };
        _resetMailerForTesting();
    });

    it('keeps the console provider when SMTP_HOST is unset', () => {
        delete process.env.SMTP_HOST;
        initMailerFromEnv();
        expect(getEmailProvider()).toBeInstanceOf(ConsoleEmailProvider);
    });

    it('swaps to a Nodemailer provider when SMTP_HOST is set, and never logs the password', () => {
        process.env.SMTP_HOST = 'smtp.configured';
        process.env.SMTP_PORT = '2525';
        process.env.SMTP_USER = 'envuser';
        process.env.SMTP_PASS = 'envpass-secret'; // pragma: allowlist secret
        process.env.SMTP_FROM = 'env-from@test';

        initMailerFromEnv();

        expect(getEmailProvider()).toBeInstanceOf(NodemailerProvider);
        const cfg = createTransportMock.mock.calls[0][0];
        expect(cfg.host).toBe('smtp.configured');
        // The real @/env coerces SMTP_PORT; the Jest mock passes the string,
        // which the mailer turns into a number either way.
        expect(cfg.port).toBe(2525);
        expect(cfg.auth).toEqual({ user: 'envuser', pass: 'envpass-secret' }); // pragma: allowlist secret
        expect(logger.info).toHaveBeenCalledWith(
            'Mailer initialised: SMTP transport',
            expect.objectContaining({ host: 'smtp.configured', port: 2525, hasAuth: true, from: 'env-from@test' }),
        );
        const logged = JSON.stringify((logger.info as unknown as jest.Mock).mock.calls);
        expect(logged).not.toContain('envpass-secret');
    });

    it('applies the default port and sender when only SMTP_HOST is set', () => {
        process.env.SMTP_HOST = 'smtp.bare';
        delete process.env.SMTP_PORT;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;
        delete process.env.SMTP_FROM;

        initMailerFromEnv();

        const cfg = createTransportMock.mock.calls[0][0];
        expect(cfg.host).toBe('smtp.bare');
        expect(cfg.port).toBe(587); // documented default
        expect(cfg.auth).toBeUndefined(); // no creds → no auth block
    });

    it('the first sendEmail of an uninitialised module copy picks up SMTP from the environment', async () => {
        process.env.SMTP_HOST = 'smtp.lazy';
        await expect(sendEmail(BASE_MSG)).resolves.toEqual({ delivered: true });
        expect(getEmailProvider()).toBeInstanceOf(NodemailerProvider);
        expect(sendMailMock).toHaveBeenCalledTimes(1);
    });

    it('the lazy init never replaces a provider a caller set', async () => {
        process.env.SMTP_HOST = 'smtp.lazy';
        const stub = new StubEmailProvider();
        setEmailProvider(stub);
        await sendEmail(BASE_MSG);
        expect(getEmailProvider()).toBe(stub);
        expect(createTransportMock).not.toHaveBeenCalled();
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
