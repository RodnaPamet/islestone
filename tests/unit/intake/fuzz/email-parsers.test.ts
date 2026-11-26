/**
 * Property fuzzing of the inbound email parsers (Hardening H2f;
 * docs/porting/maps/H2.md part 6): `mime.ts`, `rfc2047.ts`, `text.ts` and
 * `content.ts` under `src/lib/intake/email/`, over messages mutated from the
 * seed corpus (`email-corpus.ts`).
 *
 * For any message mutated from the corpus, up to `FUZZ_MESSAGE_MAX_BYTES`:
 *   - parsing never throws;
 *   - it finishes in under 50 ms (a pattern that backtracks shows as a
 *     timeout, not as a slow night);
 *   - the output is bounded: a title of 1 to 200 characters with no control
 *     character, a body of at most 10,000, an address with no whitespace,
 *     an attachment count no larger than the message's lines;
 *   - no markup re-forms in what is stored (`<scr<script>ipt>`): the title and
 *     body as the usecase sanitises them hold no element when read as HTML.
 * And at the raw message's own cap, 10 MB (`RAW_EMAIL_MAX_BYTES`), every
 * hostile shape finishes within two seconds: linear time, where a quadratic
 * step takes minutes.
 */
import fc from 'fast-check';
import sanitizeHtml from 'sanitize-html';

import { contentFromRaw, MAX_BODY, MAX_HEADER_SCAN, MAX_HTML_SCAN, MAX_TEXT_SCAN, MAX_TITLE } from '@/lib/intake/email/content';
import { displayHeader, parseEmail } from '@/lib/intake/email/mime';
import { RAW_EMAIL_MAX_BYTES } from '@/lib/intake/email/resend-download';
import { decodeEncodedWords } from '@/lib/intake/email/rfc2047';
import { decodeEntities, htmlToText, stripQuotedHistory } from '@/lib/intake/email/text';
import { sanitizePlainText } from '@/lib/security/sanitize';

import { assertFuzz, bestTimeMs, fuzzTimeout } from '../../../helpers/fuzz';

import { loadCorpus } from './email-corpus';

/** The largest message a mutation makes. */
const FUZZ_MESSAGE_MAX_BYTES = 256 * 1024;
const PER_MESSAGE_MS = 50;
const AT_CAP_MS = 2_000;

const corpus = loadCorpus();
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');
/** A string's UTF-8 bytes, one latin1 character each, so it splices into a raw message. */
const utf8 = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

/** Pieces that matter to a MIME, header, HTML or quoting parser. */
const TOKENS = [
    '\r\n',
    '\n',
    '\r',
    '\r\n\r\n',
    '\r\n ',
    '--',
    '--p\r\n',
    '--p--',
    'Content-Type: multipart/mixed; boundary="p"\r\n',
    'Content-Type: text/html; charset=utf-8\r\n',
    'Content-Type: message/rfc822\r\n',
    'Content-Transfer-Encoding: base64\r\n',
    'Content-Transfer-Encoding: quoted-printable\r\n',
    'Content-Disposition: attachment; filename="x.bin"\r\n',
    '=?utf-8?B?',
    '=?x-unknown?Q?',
    '?=',
    '=',
    '=\r\n',
    '=ZZ',
    '<',
    '>',
    '<blockquote>',
    '</blockquote>',
    '<blockquote',
    '<li',
    '<p ',
    '<br',
    '<scr<script>ipt>',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '&#x',
    '&lt;script&gt;',
    '&#60;svg onload=alert(1)&#62;',
    '\u0000',
    utf8('‮'),
    utf8('⁦'),
    utf8('​'),
    utf8('Принтер'),
    'ÿþ',
    'On Mon, 2 Feb 2026 at 09:00, A <a@b.c> wrote:',
    '> ',
    '-- ',
    'From: x\r\nSent: y\r\n',
    'Subject: ',
    'From: ',
    'Authentication-Results: mx.inbound.test; dmarc=pass header.from=example.com\r\n',
    '(',
    ')',
    '"',
    '@',
    'a',
    ' ',
];

type Op =
    | { kind: 'insert'; at: number; token: string }
    | { kind: 'delete'; at: number; len: number }
    | { kind: 'repeat'; at: number; len: number; times: number }
    | { kind: 'pad'; at: number; token: string; bytes: number }
    | { kind: 'byte'; at: number; byte: number }
    | { kind: 'truncate'; at: number };

const tokenArb = fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...TOKENS) }, { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 12 }).map(utf8) });
const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant('insert' as const), at: fc.nat(), token: tokenArb }),
    fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), len: fc.integer({ min: 1, max: 200 }) }),
    fc.record({ kind: fc.constant('repeat' as const), at: fc.nat(), len: fc.integer({ min: 1, max: 80 }), times: fc.integer({ min: 2, max: 2_000 }) }),
    fc.record({ kind: fc.constant('pad' as const), at: fc.nat(), token: tokenArb.filter((t) => t.length > 0), bytes: fc.integer({ min: 1_000, max: 200_000 }) }),
    fc.record({ kind: fc.constant('byte' as const), at: fc.nat(), byte: fc.integer({ min: 0, max: 255 }) }),
    fc.record({ kind: fc.constant('truncate' as const), at: fc.nat() }),
);

function mutate(seed: string, ops: Op[]): string {
    let m = seed;
    for (const op of ops) {
        const at = m.length === 0 ? 0 : op.at % (m.length + 1);
        switch (op.kind) {
            case 'insert':
                m = m.slice(0, at) + op.token + m.slice(at);
                break;
            case 'delete':
                m = m.slice(0, at) + m.slice(at + op.len);
                break;
            case 'repeat': {
                const piece = m.slice(at, at + op.len);
                m = m.slice(0, at) + piece.repeat(op.times) + m.slice(at + op.len);
                break;
            }
            case 'pad':
                m = m.slice(0, at) + op.token.repeat(Math.ceil(op.bytes / op.token.length)) + m.slice(at);
                break;
            case 'byte':
                m = m.slice(0, at) + String.fromCharCode(op.byte) + m.slice(at + 1);
                break;
            case 'truncate':
                m = m.slice(0, at);
                break;
        }
        if (m.length > FUZZ_MESSAGE_MAX_BYTES) m = m.slice(0, FUZZ_MESSAGE_MAX_BYTES);
    }
    return m;
}

const messageArb = fc.tuple(fc.constantFrom(...corpus), fc.array(opArb, { maxLength: 6 })).map(([seed, ops]) => ({ seed: seed.name, raw: Buffer.from(mutate(latin1(seed.bytes), ops), 'latin1') }));

/** The number of elements an HTML reading of `text` holds. */
function elementsIn(text: string): number {
    let n = 0;
    sanitizeHtml(text, {
        allowedTags: false,
        allowedAttributes: false,
        allowVulnerableTags: true,
        transformTags: {
            '*': (tagName, attribs) => {
                n++;
                return { tagName, attribs };
            },
        },
    });
    return n;
}

/** The stored title, as `cleanTitle` (`src/app-layer/usecases/intake-request.ts`) makes it. */
const storedTitle = (t: string) =>
    sanitizePlainText(t)
        .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);

function checkContent(raw: Uint8Array): void {
    const c = contentFromRaw(raw, { emailId: 'em_fuzz', authservId: 'mx.inbound.test' });
    expect(c.title.length).toBeGreaterThanOrEqual(1);
    expect(c.title.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(c.title).not.toMatch(/[\u0000-\u001f\u007f]/);
    if (c.body !== null) {
        expect(c.body.length).toBeGreaterThanOrEqual(1);
        expect(c.body.length).toBeLessThanOrEqual(MAX_BODY);
        expect(elementsIn(sanitizePlainText(c.body))).toBe(0);
    }
    expect(elementsIn(storedTitle(c.title))).toBe(0);
    if (c.fromAddress !== null) {
        expect(c.fromAddress).toMatch(/^[^\s<>]+$/);
        expect(c.fromAddress).toContain('@');
    }
    if (c.fromName !== null) expect(c.fromName).not.toMatch(/[\u0000-\u001f\u007f]/);
    const lines = latin1(raw).split('\n').length;
    expect(Number.isInteger(c.attachmentsDropped)).toBe(true);
    expect(c.attachmentsDropped).toBeGreaterThanOrEqual(0);
    expect(c.attachmentsDropped).toBeLessThanOrEqual(lines + 1);
    expect(c.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    // Decoding never grows text past its bytes; a part's lines are rejoined with
    // CRLF, so a part written with bare LFs can at most double.
    const parsed = parseEmail(raw);
    expect((parsed.text ?? '').length).toBeLessThanOrEqual(2 * raw.byteLength);
    expect((parsed.html ?? '').length).toBeLessThanOrEqual(2 * raw.byteLength);
}

describe('the inbound email parsers (fuzzed, from the seed corpus)', () => {
    it('reads every corpus message as it is', () => {
        expect(corpus.length).toBeGreaterThanOrEqual(11);
        for (const m of corpus) checkContent(m.bytes);
    });

    it(
        'never throws, finishes in under 50 ms and bounds its output, for any mutated message',
        () => {
            assertFuzz(
                fc.property(messageArb, ({ raw }) => {
                    checkContent(raw);
                    const ms = bestTimeMs(() => contentFromRaw(raw, { emailId: 'em_fuzz', authservId: 'mx.inbound.test' }), PER_MESSAGE_MS);
                    expect(ms).toBeLessThanOrEqual(PER_MESSAGE_MS);
                }),
            );
        },
        fuzzTimeout(60),
    );

    it(
        'decodes encoded words without throwing, never longer than the input, and a display header holds no control character',
        () => {
            const wordish = fc.array(fc.constantFrom('=?', '?=', 'utf-8', 'iso-8859-1', 'x-bogus', '?B?', '?Q?', '?b?', 'QUJD', '=4', '=41', '_', ' ', '\r\n', '\t', '\u0000', '*', 'a'), { maxLength: 40 }).map((p) => p.join(''));
            assertFuzz(
                fc.property(fc.oneof(wordish, fc.string({ maxLength: 200 })), (value) => {
                    expect(decodeEncodedWords(value).length).toBeLessThanOrEqual(value.length);
                    expect(displayHeader(value)).not.toMatch(/[\u0000-\u001f\u007f]/);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'turns any long hostile run into text in linear time, and what is stored holds no element',
        () => {
            const piece = fc.constantFrom('<', '>', '<li', '<p ', '<br', '<i>', '<b>x', '<div>', '<blockquote', '</blockquote', '&#x', '&lt;', '(', '"', 'a', ' ', '\n', 'On x wrote:', '> ', '=?a?B?', '?=', '<scr<script>ipt>');
            /** A short prefix, one short unit repeated to `max`, a short suffix. */
            const hostile = (max: number) =>
                fc
                    .tuple(fc.array(piece, { maxLength: 2 }), fc.array(piece, { minLength: 1, maxLength: 2 }), fc.array(piece, { maxLength: 2 }), fc.integer({ min: Math.floor(max / 4), max }))
                    .map(([pre, unit, post, n]) => pre.join('') + unit.join('').repeat(Math.ceil(n / unit.join('').length)) + post.join(''));
            assertFuzz(
                // Each at the most the content code hands it: `MAX_HTML_SCAN` of HTML,
                // `MAX_TEXT_SCAN` of text, `MAX_HEADER_SCAN` of a header.
                fc.property(hostile(MAX_HTML_SCAN), hostile(MAX_TEXT_SCAN), hostile(MAX_HEADER_SCAN), (html, text, header) => {
                    expect(bestTimeMs(() => htmlToText(html), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
                    expect(bestTimeMs(() => stripQuotedHistory(text), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
                    expect(bestTimeMs(() => displayHeader(header), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
                    expect(elementsIn(sanitizePlainText(htmlToText(html).slice(0, MAX_BODY)))).toBe(0);
                }),
                { scale: 0.5 },
            );
        },
        fuzzTimeout(200, 0.5),
    );
});

/** The hostile shapes at the raw message's cap, each a header or a part made of one unit repeated to 10 MB. */
const AT_CAP_SHAPES: Array<{ name: string; message: (fill: (unit: string) => string) => string }> = [
    { name: 'unclosed blockquotes in HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<blockquote')}` },
    { name: 'unclosed list items in HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<li')}` },
    { name: 'unclosed paragraphs in HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<p ')}` },
    { name: 'balanced HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<div><b>x</b></div>')}` },
    { name: 'unclosed nested tags in HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<i>')}` },
    { name: 'unclosed nested tags with text in HTML', message: (f) => `Content-Type: text/html\r\n\r\n${f('<b>x')}` },
    { name: 'a From display name of nested tags', message: (f) => `From: "${f('<i>')}" <a@b.c>\r\n\r\nx` },
    { name: 'a From with no @', message: (f) => `From: ${f('a')}\r\n\r\nx` },
    { name: 'a From of unclosed brackets and @', message: (f) => `From: <${f('a@')}\r\n\r\nx` },
    { name: 'an Authentication-Results of open comments', message: (f) => `Authentication-Results: mx.inbound.test; ${f('(')}\r\nFrom: a@b.c\r\n\r\nx` },
    { name: 'an Authentication-Results of one long word', message: (f) => `Authentication-Results: mx.inbound.test; dkim=pass ${f('a')}\r\nFrom: a@b.c\r\n\r\nx` },
    { name: 'tiny parts past the cap', message: (f) => `Content-Type: multipart/mixed; boundary=b\r\n\r\n${f('--b\r\n\r\n')}` },
    { name: 'long plain lines', message: (f) => `From: a@b.c\r\n\r\n${f('hello world\r\n')}` },
    { name: 'quoted history lines', message: (f) => `From: a@b.c\r\n\r\n${f('> On x wrote:\r\n')}` },
    { name: 'quoted-printable soft breaks', message: (f) => `Content-Transfer-Encoding: quoted-printable\r\n\r\n${f('=41=\r\n')}` },
    { name: 'a folded subject', message: (f) => `Subject: ${f('word\r\n ')}\r\n\r\nx` },
    { name: 'encoded words', message: (f) => `Subject: ${f('=?utf-8?B?QUJD?= ')}\r\n\r\nx` },
];

describe('the inbound email parsers at the raw message cap (10 MB)', () => {
    it.each(AT_CAP_SHAPES.map((s) => [s.name, s] as const))(
        'reads %s in linear time',
        (_name, shape) => {
            const room = RAW_EMAIL_MAX_BYTES - 200;
            const raw = Buffer.from(shape.message((unit) => unit.repeat(Math.floor(room / unit.length))), 'latin1');
            expect(raw.byteLength).toBeLessThanOrEqual(RAW_EMAIL_MAX_BYTES);
            expect(bestTimeMs(() => contentFromRaw(raw, { emailId: 'em_cap', authservId: 'mx.inbound.test' }), AT_CAP_MS, 2)).toBeLessThanOrEqual(AT_CAP_MS);
        },
        30_000,
    );
});

describe('the inbound email parsers: the linear HTML rewrites answer as the patterns they replaced', () => {
    /** `htmlToText` before H2f, whole, kept as the reference on inputs too short to blow up. */
    function legacyHtmlToText(html: string): string {
        const blocks = html
            .replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<li\b[^>]*>/gi, '\n- ')
            .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol|section|article|header|footer)\s*>/gi, '\n')
            .replace(/<(p|div|tr|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n');
        const stripped = sanitizeHtml(blocks, { allowedTags: [], allowedAttributes: {}, nonTextTags: ['script', 'style', 'head', 'title', 'noscript', 'textarea', 'option'] });
        return decodeEntities(stripped)
            .split('\n')
            .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    it(
        'gives the same text for any short HTML',
        () => {
            const piece = fc.constantFrom('<blockquote>', '<BLOCKQUOTE x>', '</blockquote>', '</blockquote >', '<blockquote', '<li>', '<li', '<LI class=a>', '<p>', '<p ', '</p>', '<br>', '<br/>', '<br', '<div>', '</div >', '>', '<', 'a', ' ', '\n', 'x', '&amp;');
            assertFuzz(
                fc.property(fc.array(piece, { maxLength: 24 }).map((p) => p.join('')), (html) => {
                    expect(htmlToText(html)).toBe(legacyHtmlToText(html));
                }),
            );
        },
        fuzzTimeout(2),
    );
});

describe('the inbound email parsers: examples the fuzzing found (H2f)', () => {
    it('turns a run of unclosed list items into text in linear time (seed 874120566)', () => {
        // `/<li\b[^>]*>/gi` scanned to the end of the text from every `<li`: 120 KB took 3.5 s.
        expect(bestTimeMs(() => htmlToText('<li'.repeat(40_000)), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
        expect(bestTimeMs(() => htmlToText('<p '.repeat(40_000)), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
        expect(htmlToText('<ul><li>one<li>two</ul>')).toBe('- one\n- two');
    });

    it('drops quoted blocks, and reads a run of unclosed ones in linear time (seed -1637463199)', () => {
        // `/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi`: a megabyte of unclosed quotes took 33 s.
        expect(bestTimeMs(() => htmlToText('<blockquote'.repeat(10_000)), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
        expect(htmlToText('<p>Yes.</p><blockquote>old<blockquote>older</blockquote>tail</blockquote><p>Ada</p>')).toBe('Yes.\n\ntail\nAda');
        expect(htmlToText('<p>Keep</p><blockquote>no end')).toBe('Keep\nno end');
    });

    it('reads the HTML of a 10 MB message of nested unclosed tags in milliseconds (the at-cap shapes)', () => {
        // The HTML sanitiser's time grows with the square of unclosed nesting; the
        // whole part was converted before, so `<i>` repeated to 10 MB held the worker for minutes.
        const raw = Buffer.from(`Content-Type: text/html\r\n\r\n${'<i>'.repeat(3_000_000)}`, 'latin1');
        expect(bestTimeMs(() => contentFromRaw(raw, { emailId: 'em_cap' }), AT_CAP_MS, 2)).toBeLessThanOrEqual(AT_CAP_MS);
    });
});

describe('the inbound email parsers: a sender that imitates an ASCII address (H2f)', () => {
    it('never verifies a From spelt with the Kelvin sign, even under a trusted DMARC pass naming it', () => {
        const raw = (from: string) =>
            Buffer.from(`Authentication-Results: mx.inbound.test; dmarc=pass header.from=${from.split('@')[1]}\r\nFrom: ${from}\r\nSubject: hi\r\n\r\nbody\r\n`, 'utf8');
        expect(contentFromRaw(raw('kate@kexample.com'), { emailId: 'e', authservId: 'mx.inbound.test' }).senderCheck).toBe('VERIFIED');
        const forged = contentFromRaw(raw('kate@Kexample.com'), { emailId: 'e', authservId: 'mx.inbound.test' });
        expect(forged.fromAddress).toBe('kate@Kexample.com');
        expect(forged.senderCheck).toBe('NONE');
    });
});

describe('the inbound email parsers: encoded words naming an unknown charset (H2f)', () => {
    it('decodes thousands of them in linear time (seed 2014847410)', () => {
        // Each built a decoder for the unknown label, and each build threw.
        const header = '?==?a?B?'.repeat(6_200);
        expect(bestTimeMs(() => displayHeader(header), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
        expect(decodeEncodedWords('=?x-unknown-42?B?SGVsbG8=?= =?utf-8?Q?_w=C3=B6rld?=')).toBe('Hello wörld');
    });
});

describe('the inbound email parsers: a rewrite that removes the last > (H2f)', () => {
    it('turns a run of unclosed paragraphs ending in a list item into text in linear time (seed -2011118502)', () => {
        // `<li<i>` became a line break, so the run of `<p ` before it had no `>` left
        // and the paragraph pattern scanned to the end from each one: 32 KB took a third of a second.
        const html = `${'<p '.repeat(10_000)}<li<i>`;
        expect(bestTimeMs(() => htmlToText(html), PER_MESSAGE_MS)).toBeLessThanOrEqual(PER_MESSAGE_MS);
        expect(htmlToText('<p class=a>One<li>two<li<i>')).toBe('One\n- two\n-');
    });
});
