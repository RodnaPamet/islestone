/**
 * The mailer — the transport-independent half of inflect-compliance's
 * `src/lib/mailer.ts` (5528464fc54a8681956f3b9ce23ca9c075f0420e).
 *
 * Sub-phase 1.4 needs `sendEmail` (verification, password reset, MFA and
 * invite mail). The SMTP transport (`NodemailerProvider`, `initMailerFromEnv`)
 * and the react-email templates arrive with sub-phase 1.6, which replaces
 * this file. Until then every message goes to the console sink, which logs
 * it, and `sendEmail` reports `delivered: false`, so no caller tells a person
 * "we emailed it" when nothing was sent.
 */
import { env } from '@/env';
import { logger } from '@/lib/observability/logger';

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
    bcc?: string;
    attachments?: EmailAttachment[];
}

export interface EmailProvider {
    send(msg: EmailMessage): Promise<void>;
}

// ─── Console (dev, and every environment until 1.6) ───

export class ConsoleEmailProvider implements EmailProvider {
    async send(msg: EmailMessage): Promise<void> {
        const fields = {
            component: 'mailer',
            to: msg.to,
            subject: msg.subject,
            bodyPreview: msg.text.substring(0, 200),
            ...(msg.from && { from: msg.from }),
            ...(msg.bcc && { bcc: msg.bcc }),
            ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => a.filename) } : {}),
        };
        // In production a send hitting the console sink means the email was
        // DROPPED. Log at WARN so it is visible.
        if (env.NODE_ENV === 'production') {
            logger.warn('Email NOT delivered — mailer is on the console sink (no SMTP transport until sub-phase 1.6)', fields);
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
