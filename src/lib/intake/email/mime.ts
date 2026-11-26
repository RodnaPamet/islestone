/**
 * A bounded MIME parser for received intake email (sub-phase 2.6c; owner
 * decision 122). It reads what intake needs and nothing else: the headers
 * (unfolded, RFC 2047 decoded on demand), the first `text/plain` and first
 * `text/html` body that are not attachments (transfer encodings and charsets
 * decoded), and a count of attachments, which are never kept (until 4.4).
 *
 * Bounded on purpose, because the message is untrusted input: at most
 * `MAX_DEPTH` levels of nesting and `MAX_PARTS` parts; anything past those is
 * counted as dropped rather than parsed; and at most `MAX_TEXT_PART_BYTES` of
 * a text part decoded. Every step is linear in the message's length
 * (Hardening H2f fuzzes it: tests/unit/intake/fuzz/email-parsers.test.ts). Written fresh for Islestone rather
 * than taking a mail library: the surface is small, and every byte of it is
 * tested here (tests/unit/intake/email-parsing.test.ts).
 */
import { decodeCharset, decodeEncodedWords } from './rfc2047';

export const MAX_DEPTH = 8;
export const MAX_PARTS = 200;
/**
 * How much of a text part's encoded body is decoded (512 KB): far more than
 * the 10,000 characters a request keeps, even as quoted-printable or HTML.
 */
export const MAX_TEXT_PART_BYTES = 512 * 1024;

export interface ParsedHeaders {
    /** Every value of a header, in order (names lower-cased). */
    all(name: string): string[];
    /** The first value, or null. */
    get(name: string): string | null;
}

export interface ParsedEmail {
    headers: ParsedHeaders;
    text: string | null;
    html: string | null;
    attachments: number;
    /** The top-level content type, lower-cased (`multipart/report` is a bounce). */
    contentType: string;
}

interface ContentType {
    type: string;
    params: Record<string, string>;
}

function headerMap(block: string): ParsedHeaders {
    const map = new Map<string, string[]>();
    let current: string | null = null;
    for (const line of block.split(/\r?\n/)) {
        if (/^[ \t]/.test(line) && current !== null) {
            const list = map.get(current)!;
            list[list.length - 1] += ` ${line.trim()}`;
            continue;
        }
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        current = line.slice(0, colon).trim().toLowerCase();
        const list = map.get(current) ?? [];
        list.push(line.slice(colon + 1).trim());
        map.set(current, list);
    }
    return {
        all: (name) => map.get(name.toLowerCase()) ?? [],
        get: (name) => map.get(name.toLowerCase())?.[0] ?? null,
    };
}

function parseParams(value: string): ContentType {
    const parts = value.split(';');
    const type = (parts.shift() ?? '').trim().toLowerCase() || 'text/plain';
    const params: Record<string, string> = {};
    for (const p of parts) {
        const eq = p.indexOf('=');
        if (eq < 0) continue;
        const key = p.slice(0, eq).trim().toLowerCase().replace(/\*$/, '');
        let val = p.slice(eq + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        params[key] = val;
    }
    return { type, params };
}

/** Split a raw message (as latin1, one char per byte) into its header block and body. */
function splitHead(raw: string): { head: string; body: string } {
    const m = /\r?\n\r?\n/.exec(raw);
    if (!m) return { head: raw, body: '' };
    return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function decodeQuotedPrintable(body: string): Uint8Array {
    const soft = body.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < soft.length; i++) {
        const c = soft[i]!;
        if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
            bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
            i += 2;
        } else bytes.push(c.charCodeAt(0) & 0xff);
    }
    return Uint8Array.from(bytes);
}

function decodeTransfer(body: string, encoding: string | null): Uint8Array {
    switch ((encoding ?? '').trim().toLowerCase()) {
        case 'base64':
            return Uint8Array.from(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'));
        case 'quoted-printable':
            return decodeQuotedPrintable(body);
        default:
            return Uint8Array.from(Buffer.from(body, 'latin1'));
    }
}

function splitMultipart(body: string, boundary: string): string[] {
    const delimiter = `--${boundary}`;
    const lines = body.split(/\r?\n/);
    const parts: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed === `${delimiter}--`) {
            if (current) parts.push(current.join('\r\n'));
            current = null;
            break;
        }
        if (trimmed === delimiter) {
            if (current) parts.push(current.join('\r\n'));
            current = [];
            continue;
        }
        if (current) current.push(line);
    }
    if (current) parts.push(current.join('\r\n'));
    return parts;
}

/** Parse `raw` (the message's bytes). */
export function parseEmail(raw: Uint8Array | string): ParsedEmail {
    const latin1 = typeof raw === 'string' ? Buffer.from(raw, 'utf8').toString('latin1') : Buffer.from(raw).toString('latin1');
    const { head, body } = splitHead(latin1);
    // Header bytes may be raw UTF-8 (RFC 6532); decode them as UTF-8.
    const headers = headerMap(Buffer.from(head, 'latin1').toString('utf8'));
    const out: ParsedEmail = { headers, text: null, html: null, attachments: 0, contentType: parseParams(headers.get('content-type') ?? 'text/plain').type };
    let parts = 0;

    const walk = (h: ParsedHeaders, b: string, depth: number): void => {
        parts++;
        if (parts > MAX_PARTS || depth > MAX_DEPTH) {
            out.attachments++;
            return;
        }
        const ct = parseParams(h.get('content-type') ?? 'text/plain; charset=us-ascii');
        const disposition = parseParams(h.get('content-disposition') ?? 'inline');
        if (ct.type.startsWith('multipart/') && ct.params.boundary) {
            for (const part of splitMultipart(b, ct.params.boundary)) {
                // Past the cap a part is only counted: its headers are not read
                // (what `walk` would do with it, without the work; H2f).
                if (parts >= MAX_PARTS) {
                    parts++;
                    out.attachments++;
                    continue;
                }
                const split = splitHead(part.startsWith('\r\n') || part.startsWith('\n') ? `\r\n${part}` : part);
                walk(headerMap(Buffer.from(split.head, 'latin1').toString('utf8')), split.body, depth + 1);
            }
            return;
        }
        const named = Boolean(disposition.params.filename || ct.params.name);
        const isAttachment = disposition.type === 'attachment' || named;
        if (!isAttachment && (ct.type === 'text/plain' || ct.type === 'text/html')) {
            // Only the first `MAX_TEXT_PART_BYTES` of a text part are decoded:
            // the request keeps 10,000 characters of it, so decoding the rest
            // of a 10 MB part is work for nothing (H2f).
            const text = decodeCharset(decodeTransfer(b.slice(0, MAX_TEXT_PART_BYTES), h.get('content-transfer-encoding')), ct.params.charset);
            if (ct.type === 'text/plain' && out.text === null) out.text = text;
            else if (ct.type === 'text/html' && out.html === null) out.html = text;
            return;
        }
        out.attachments++;
    };
    walk(headers, body, 0);
    return out;
}

/** A header decoded for display: encoded words decoded, CR, LF and other controls removed. */
export function displayHeader(value: string | null): string {
    if (!value) return '';
    return decodeEncodedWords(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}
