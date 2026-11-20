/**
 * A received email as an intake request's fields (sub-phase 2.6c;
 * docs/porting/maps/2.6.md "Parsing"): the subject as the title (decoded, CR
 * and LF removed, at most 200 characters), the plain-text part (else the HTML
 * part turned into text) with quoted history stripped as the body (at most
 * 10,000), the sender, the Message-ID's hash (one request per message),
 * attachments counted, whether it is an auto-reply or a bounce, and the
 * sender check from `Authentication-Results`. Sanitising happens in the
 * usecase that stores it. Server-only (it hashes); written fresh for
 * Islestone.
 */
import { createHash } from 'node:crypto';

import { domainOf, mailboxOf } from './address';
import { senderCheckFrom, type SenderCheck } from './auth-results';
import { displayHeader, parseEmail } from './mime';
import { htmlToText, isAutomatedMessage, stripQuotedHistory } from './text';

export const NO_SUBJECT = 'No subject';
export const MAX_TITLE = 200;
export const MAX_BODY = 10_000;

export interface InboundContent {
    title: string;
    body: string | null;
    fromAddress: string | null;
    fromName: string | null;
    /** sha256 of the Message-ID, else of the provider's email id. */
    dedupeHash: string;
    attachmentsDropped: number;
    automated: boolean;
    senderCheck: SenderCheck;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function bodyOf(text: string | null, html: string | null): string | null {
    const raw = text && text.trim() ? text : html ? htmlToText(html) : '';
    const stripped = stripQuotedHistory(raw).slice(0, MAX_BODY).trim();
    return stripped.length > 0 ? stripped : null;
}

function titleOf(subject: string | null): string {
    const t = displayHeader(subject).slice(0, MAX_TITLE).trim();
    return t.length > 0 ? t : NO_SUBJECT;
}

/** From the raw `.eml`: the whole message, headers included. */
export function contentFromRaw(raw: Uint8Array, opts: { emailId: string; authservId?: string }): InboundContent {
    const parsed = parseEmail(raw);
    const from = mailboxOf(displayHeader(parsed.headers.get('from')));
    const messageId = parsed.headers.get('message-id')?.trim();
    return {
        title: titleOf(parsed.headers.get('subject')),
        body: bodyOf(parsed.text, parsed.html),
        fromAddress: from.address,
        fromName: from.name,
        dedupeHash: sha256(messageId || `provider:${opts.emailId}`),
        attachmentsDropped: parsed.attachments,
        automated: isAutomatedMessage(parsed.headers, parsed.contentType, from.address),
        senderCheck: senderCheckFrom(parsed.headers.all('authentication-results'), opts.authservId, domainOf(from.address)),
    };
}

/**
 * From the provider's parsed fields alone, when the raw message could not be
 * read (too large, an unexpected host): no headers, so no auto-reply test and
 * no authentication, so NONE.
 */
export function contentFromFields(fields: {
    emailId: string;
    subject: string | null;
    from: string | null;
    text: string | null;
    html: string | null;
    messageId: string | null;
    attachments: number;
}): InboundContent {
    const from = mailboxOf(displayHeader(fields.from));
    return {
        title: titleOf(fields.subject),
        body: bodyOf(fields.text, fields.html),
        fromAddress: from.address,
        fromName: from.name,
        dedupeHash: sha256(fields.messageId?.trim() || `provider:${fields.emailId}`),
        attachmentsDropped: fields.attachments,
        automated: false,
        senderCheck: 'NONE',
    };
}
