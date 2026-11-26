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

import { domainOf, hasAsciiLookalike, mailboxOf } from './address';
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

/**
 * How much of the text, or of the HTML, the body is made from (Hardening
 * H2f). The body keeps `MAX_BODY` characters; the text scan leaves room for
 * quoted history before them. The HTML scan is smaller because the HTML
 * sanitiser's time grows with the square of unclosed nesting (`<i>` repeated:
 * a second for 256 KB): 32 KB keeps the worst HTML a sender can write to a few
 * milliseconds, and an HTML part is read only when the plain-text part is
 * empty.
 */
export const MAX_TEXT_SCAN = 100_000;
export const MAX_HTML_SCAN = 32 * 1024;

function bodyOf(text: string | null, html: string | null): string | null {
    const raw = text && text.trim() ? text.slice(0, MAX_TEXT_SCAN) : html ? htmlToText(html.slice(0, MAX_HTML_SCAN)) : '';
    const stripped = stripQuotedHistory(raw).slice(0, MAX_BODY).trim();
    return stripped.length > 0 ? stripped : null;
}

/**
 * How much of a raw `Subject` or `From` is decoded (16 KB): the title keeps
 * 200 characters and an address 254, so a longer header is work for nothing
 * (a folded 10 MB header; Hardening H2f).
 */
export const MAX_HEADER_SCAN = 16 * 1024;

const headerHead = (value: string | null) => (value === null ? null : value.slice(0, MAX_HEADER_SCAN));

function titleOf(subject: string | null): string {
    const t = displayHeader(headerHead(subject)).slice(0, MAX_TITLE).trim();
    return t.length > 0 ? t : NO_SUBJECT;
}

/** From the raw `.eml`: the whole message, headers included. */
export function contentFromRaw(raw: Uint8Array, opts: { emailId: string; authservId?: string }): InboundContent {
    const parsed = parseEmail(raw);
    const from = mailboxOf(displayHeader(headerHead(parsed.headers.get('from'))));
    const messageId = parsed.headers.get('message-id')?.trim();
    return {
        title: titleOf(parsed.headers.get('subject')),
        body: bodyOf(parsed.text, parsed.html),
        fromAddress: from.address,
        fromName: from.name,
        dedupeHash: sha256(messageId || `provider:${opts.emailId}`),
        attachmentsDropped: parsed.attachments,
        automated: isAutomatedMessage(parsed.headers, parsed.contentType, from.address),
        // An address spelt with a character that folds into ASCII is never
        // VERIFIED: the lookups that attribute a request to a member, count an
        // address as confirmed or match a follow-up fold case fully, so it
        // would pass for the address it imitates (Hardening H2f).
        senderCheck:
            from.address !== null && hasAsciiLookalike(from.address)
                ? 'NONE'
                : senderCheckFrom(parsed.headers.all('authentication-results'), opts.authservId, domainOf(from.address)),
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
    const from = mailboxOf(displayHeader(headerHead(fields.from)));
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
