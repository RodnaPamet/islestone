/**
 * Email provider abstraction.
 *
 * Providers:
 * - ConsoleEmailProvider: logs the message (dev, and any deployment without
 *   SMTP configured): it reaches nobody
 * - NodemailerProvider:   sends through an SMTP relay (production)
 * - StubEmailProvider:    records messages for tests
 *
 * Copied from inflect-compliance `src/lib/mailer.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. `nodemailer` is MIT-0, allowed by
 * owner decision of 2026-11-19 (ADR 0007 E8). Changed: the SMTP settings are
 * read through `@/env`, not raw `process.env`; no log line carries a
 * recipient's address, the subject or the body (`recipientLogFields`, owner
 * decision of 2026-11-19); the BCC is the workspace's BCC mailbox.
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { env } from '@/env';
import { deploymentSenderAddress } from '@/lib/email/sender-identity';
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
    /** A Reply-To (2.6c: an emailed request's reply address). */
    replyTo?: string;
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

// ─── Console (dev, and a deployment without SMTP) ───

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
            logger.warn('Email NOT delivered — mailer is on the console sink (SMTP unconfigured or uninitialised)', fields);
        } else {
            logger.debug('Email sent (dev console sink)', fields);
        }
    }
}

// ─── Nodemailer (production SMTP) ───

export interface SmtpConfig {
    host: string;
    port: number;
    user?: string;
    pass?: string;
    from: string;
}

export class NodemailerProvider implements EmailProvider {
    private readonly transporter: Transporter;
    private readonly from: string;

    constructor(config: SmtpConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            // 465 is implicit TLS; every other port upgrades with STARTTLS.
            secure: config.port === 465,
            ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
        });
        this.from = config.from;
    }

    async send(msg: EmailMessage): Promise<void> {
        await this.transporter.sendMail({
            from: msg.from || this.from,
            to: msg.to,
            subject: msg.subject,
            text: msg.text,
            ...(msg.html ? { html: msg.html } : {}),
            ...(msg.bcc ? { bcc: msg.bcc } : {}),
            ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
            ...(msg.attachments ? { attachments: msg.attachments } : {}),
        });
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
let envInitAttempted = false;

export function setEmailProvider(p: EmailProvider) {
    provider = p;
}

export function getEmailProvider(): EmailProvider {
    return provider;
}

/**
 * What a send did with the message. `delivered` is false when the message
 * went to the console sink and reached nobody: a caller that tells a person
 * "we emailed it" must read this, because a send that resolves is not, by
 * itself, a delivery.
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
    // Lazy, per-module-instance init (inflect-compliance): a bundler can load
    // this module in a different chunk for a route handler than the one the
    // startup hook initialised, leaving that copy on the console sink. So the
    // first real send initialises from the environment, unless a caller set a
    // provider explicitly (tests' stub, `setEmailProvider`).
    if (!envInitAttempted && provider instanceof ConsoleEmailProvider) {
        envInitAttempted = true;
        initMailerFromEnv();
    }
    // Read the provider once, so the answer describes the transport that
    // actually took this message.
    const transport = provider;
    await transport.send(msg);
    return { delivered: !(transport instanceof ConsoleEmailProvider) };
}

/**
 * Initialize the provider from environment variables. Called once at process
 * start by `src/instrumentation-node.ts` and `scripts/worker.ts`
 * (`tests/guards/mailer-init-wiring.test.ts` holds both), and lazily by the
 * first `sendEmail` in a module copy nothing initialised.
 *
 * Read through `@/env`. inflect-compliance read `process.env.SMTP_*` raw,
 * because one of its route chunks held a copy of its env module without the
 * server variables; Islestone's rule forbids the raw read, and the lazy init
 * above covers a chunk that was never initialised.
 *
 * `SMTP_HOST` set: the SMTP transport, from `deploymentSenderAddress()`, with
 * credentials when both `SMTP_USER` and `SMTP_PASS` are set (the log line
 * says whether, never what). Unset: the console sink stays, and production
 * says so at WARN, because no email leaves the process.
 */
export function initMailerFromEnv(): void {
    const host = env.SMTP_HOST;
    if (host) {
        const port = env.SMTP_PORT !== undefined ? Number(env.SMTP_PORT) : 587;
        const user = env.SMTP_USER || undefined;
        const pass = env.SMTP_PASS || undefined;
        const from = deploymentSenderAddress();
        setEmailProvider(new NodemailerProvider({ host, port, user, pass, from }));
        logger.info('Mailer initialised: SMTP transport', {
            component: 'mailer',
            host,
            port,
            secure: port === 465,
            hasAuth: !!(user && pass),
            from,
        });
    } else if (env.NODE_ENV === 'production') {
        logger.warn('Mailer on console sink — SMTP_HOST unset; email will not be delivered', {
            component: 'mailer',
        });
    }
}

/** Test seam: forget that the lazy init ran, so a test can exercise it again. */
export function _resetMailerForTesting(): void {
    provider = new ConsoleEmailProvider();
    envInitAttempted = false;
}
