/**
 * Email provider abstraction.
 *
 * Providers:
 * - ConsoleEmailProvider: logs the message (dev, and every environment until
 *   an SMTP transport is installed)
 * - StubEmailProvider:    records messages for tests
 *
 * Copied from inflect-compliance `src/lib/mailer.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, WITHOUT its SMTP transport.
 * inflect sends through `nodemailer`, which is licensed MIT-0, and MIT-0 is
 * not on the licence allowlist (`scripts/licence-gate.mjs`): allowing it is an
 * owner decision (ADR 0007). Until then every message goes to the console
 * sink, which logs it, and `sendEmail` reports `delivered: false`, so no
 * caller tells a person "we emailed it" when nothing was sent. The outbox
 * (`processOutbox`) still claims and settles rows exactly as it will with a
 * transport. `initMailerFromEnv` is called from both process entry points so
 * the transport, when it lands, needs no new wiring.
 */
import { env } from '@/env';
import { logger } from '@/lib/observability/logger';
import { hashForLookup } from '@/lib/security/encryption';

export interface EmailAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}

export interface EmailMessage {
    to: string;
    subject: string;
    text: string;
    html?: string;
    /** Override the default sender. */
    from?: string;
    /** The workspace's BCC mailbox. */
    bcc?: string;
    attachments?: EmailAttachment[];
    /**
     * Which template built the message (the outbox row's type), for the log
     * line. Never the address: see `recipientLogFields`.
     */
    template?: string;
}

/**
 * What a log line may say about a message's recipients: the lookup hash of
 * each address (`hashForLookup`, the same hash `User.emailHash` and the
 * outbox dedupe key use, so an operator can correlate without the address)
 * and the template. Never the address itself, and never the body, which
 * greets the recipient by name (owner decision, 2026-11-19, relayed by the
 * session coordinator). `tests/unit/mailer.test.ts` fails if a plain address
 * reaches the log.
 */
export function recipientLogFields(msg: Pick<EmailMessage, 'to' | 'bcc' | 'template'>): Record<string, unknown> {
    const hashes = (list: string) =>
        list
            .split(',')
            .map((a) => a.trim())
            .filter((a) => a !== '')
            .map((a) => hashForLookup(a));
    return {
        recipientHashes: hashes(msg.to),
        ...(msg.bcc ? { bccHashes: hashes(msg.bcc) } : {}),
        ...(msg.template ? { template: msg.template } : {}),
    };
}

export interface EmailProvider {
    send(msg: EmailMessage): Promise<void>;
}

// ─── Console (dev, and every environment until a transport is installed) ───

export class ConsoleEmailProvider implements EmailProvider {
    async send(msg: EmailMessage): Promise<void> {
        // No address, subject or body: the subject can name a work item and
        // the body greets the recipient by name. The sender is the
        // deployment's (or the workspace's) own address, not a person's.
        const fields = {
            component: 'mailer',
            ...recipientLogFields(msg),
            bodyLength: msg.text.length,
            ...(msg.from && { from: msg.from }),
            ...(msg.attachments?.length ? { attachments: msg.attachments.length } : {}),
        };
        // In production a send hitting the console sink means the email was
        // DROPPED. Log at WARN so it is visible.
        if (env.NODE_ENV === 'production') {
            logger.warn('Email NOT delivered — mailer is on the console sink (no SMTP transport is installed)', fields);
        } else {
            logger.debug('Email sent (dev console sink)', fields);
        }
    }
}

// ─── Stub (tests) ───

export class StubEmailProvider implements EmailProvider {
    public sentMessages: EmailMessage[] = [];

    async send(msg: EmailMessage): Promise<void> {
        this.sentMessages.push(msg);
    }

    reset(): void {
        this.sentMessages = [];
    }
}

// ─── Singleton ───

let provider: EmailProvider = new ConsoleEmailProvider();

export function setEmailProvider(p: EmailProvider) {
    provider = p;
}

export function getEmailProvider(): EmailProvider {
    return provider;
}

/**
 * What a send did with the message. `delivered` is false when the message
 * went to the console sink and reached nobody.
 */
export interface EmailDelivery {
    delivered: boolean;
}

/**
 * Whether every recipient is under the reserved `.invalid` top-level domain
 * (RFC 2606), which can never be delivered to.
 */
export function isUndeliverableRecipient(to: string): boolean {
    const addresses = to.split(',').map((a) => a.trim()).filter((a) => a !== '');
    return addresses.length > 0 && addresses.every((a) => /\.invalid>?$/i.test(a));
}

export async function sendEmail(msg: EmailMessage): Promise<EmailDelivery> {
    if (isUndeliverableRecipient(msg.to)) return { delivered: false };
    // Read the provider once, so the answer describes the transport that
    // actually took this message.
    const transport = provider;
    await transport.send(msg);
    return { delivered: !(transport instanceof ConsoleEmailProvider) };
}

/**
 * Initialize the provider from environment variables. Called once at process
 * start by `src/instrumentation-node.ts` and `scripts/worker.ts`
 * (`tests/guards/mailer-init-wiring.test.ts` holds both).
 *
 * There is no SMTP transport yet (see the module header), so this only
 * reports what the deployment asked for: an `SMTP_HOST` that cannot be used
 * is an error, and none at all in production is a warning, because either way
 * no email leaves the process.
 */
export function initMailerFromEnv(): void {
    if (env.SMTP_HOST) {
        logger.error(
            'SMTP_HOST is set but no SMTP transport is installed (nodemailer awaits a licence decision); email stays on the console sink',
            { component: 'mailer', host: env.SMTP_HOST },
        );
    } else if (env.NODE_ENV === 'production') {
        logger.warn('Mailer on console sink — SMTP_HOST unset; email will not be delivered', {
            component: 'mailer',
        });
    }
}
