/**
 * Turning a received email into a request's text (sub-phase 2.6c;
 * docs/porting/maps/2.6.md "Parsing"): HTML to plain text (block tags to
 * newlines, entities decoded, scripts and styles dropped), quoted history
 * stripped (`>`-quoted lines, and everything from an "On … wrote:" line, an
 * Outlook header block or a signature delimiter on), and the detection of
 * auto-replies and bounces, which are dropped and never answered. Heuristic
 * by nature; each rule has a fixture in tests/unit/intake/email-parsing.test.ts.
 * Pure; written fresh for Islestone.
 */

import sanitizeHtml from 'sanitize-html';

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©' };

export function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
        }
        return NAMED[e.toLowerCase()] ?? all;
    });
}

/**
 * `html` with every `<blockquote …>…</blockquote>` (each to the first close
 * after it, unnested) replaced by a line break, in one pass. The pattern this
 * replaces (`/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi`) scanned to the end of
 * the text from every opening tag that had no close after it: quadratic, half
 * a minute for a megabyte of unclosed quotes (found by Hardening H2f's
 * fuzzing). Same answers, linear time.
 */
function withoutQuoteBlocks(html: string): string {
    const open = /<blockquote\b/gi;
    const close = /<\/blockquote\s*>/gi;
    let out = '';
    let from = 0;
    for (;;) {
        open.lastIndex = from;
        const o = open.exec(html);
        if (!o) break;
        close.lastIndex = o.index + o[0].length;
        const c = close.exec(html);
        if (!c) break; // no close after this opening, so none after any later one either
        out += `${html.slice(from, o.index)}\n`;
        from = c.index + c[0].length;
    }
    return out + html.slice(from);
}

/**
 * `pattern` replaced in `html` only up to its last `>`: past it no tag can
 * close, and an opening tag with no `>` after it made `[^>]*` scan to the end
 * of the text from every `<li` or `<p` of a long run (quadratic; H2f). Before
 * the last `>`, every attempt that starts a tag finds its `>`, so the answer
 * is the same as on the whole text. The last `>` is found again for each
 * pattern, because a rewrite before it can remove one (`<li<i>` turned into a
 * line break, the run of `<p ` before it had no `>` left: found by the
 * nightly's fuzzing).
 */
function replaceBeforeLastGt(html: string, pattern: RegExp, replacement: string): string {
    const end = html.lastIndexOf('>') + 1;
    return html.slice(0, end).replace(pattern, replacement) + html.slice(end);
}

/** The block-structure rewrites, each linear (`replaceBeforeLastGt`). */
function blockBreaks(html: string): string {
    let out = replaceBeforeLastGt(html, /<br\s*\/?>/gi, '\n');
    out = replaceBeforeLastGt(out, /<li\b[^>]*>/gi, '\n- ');
    out = replaceBeforeLastGt(out, /<\/(p|div|tr|h[1-6]|table|ul|ol|section|article|header|footer)\s*>/gi, '\n');
    return replaceBeforeLastGt(out, /<(p|div|tr|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n');
}

/**
 * HTML mail to plain text. Block structure becomes line breaks first; then
 * `sanitize-html` (the library the plain-text sanitiser is built on) removes
 * every tag and comment and drops the contents of script, style, head and
 * title, so no tag is removed by a regular expression here. Its output is
 * entity-encoded text, decoded last; the stored body is sanitised again
 * (`cleanText`). A quoted reply in HTML mail is a blockquote, or Gmail's
 * quote block, and is dropped first.
 */
export function htmlToText(html: string): string {
    // A `<` that cannot open a tag (not followed by a letter, `/`, `!` or `?`)
    // is text to an HTML parser; written as `&lt;` it reads the same and costs
    // the sanitiser a fraction of the time on a long run of them (H2f).
    const blocks = blockBreaks(withoutQuoteBlocks(html)).replace(/<(?![A-Za-z/!?])/g, '&lt;');
    const stripped = sanitizeHtml(blocks, {
        allowedTags: [],
        allowedAttributes: {},
        nonTextTags: ['script', 'style', 'head', 'title', 'noscript', 'textarea', 'option'],
    });
    return decodeEntities(stripped)
        .split('\n')
        .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const CUT_AT = [
    /^On .{1,300}wrote:\s*$/i,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^-{2,}\s*Forwarded message\s*-{2,}/i,
    /^Le .{1,300} a écrit\s*:\s*$/i,
    /^Am .{1,300} schrieb .{1,200}:\s*$/i,
    /^_{10,}\s*$/,
];

/** The text without quoted history and signature. */
export function stripQuotedHistory(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const t = line.trim();
        if (CUT_AT.some((re) => re.test(t))) break;
        // "On Mon, 3 Feb 2026 at 10:00, Ada Lovelace <ada@example.com>" wrapped onto two lines.
        if (/^On .{1,200}$/i.test(t) && /wrote:\s*$/i.test((lines[i + 1] ?? '').trim()) && !/wrote:/i.test(t)) break;
        // An Outlook header block: From: … then Sent:/Date: … within a few lines.
        if (/^From:\s.+/i.test(t) && lines.slice(i + 1, i + 5).some((l) => /^(Sent|Date):\s/i.test(l.trim()))) break;
        // The signature delimiter (RFC 3676): "-- " alone.
        if (line === '-- ' || t === '--') break;
        if (t.startsWith('>')) continue;
        kept.push(line.trimEnd());
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface AutoReplyHeaders {
    get(name: string): string | null;
}

/** Whether a message is an auto-reply, a bounce or bulk mail: dropped, and never answered (no mail loops). */
export function isAutomatedMessage(h: AutoReplyHeaders, contentType: string, fromAddress: string | null): boolean {
    const autoSubmitted = h.get('auto-submitted');
    if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== 'no') return true;
    const precedence = (h.get('precedence') ?? '').trim().toLowerCase();
    if (['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return true;
    if (h.get('x-autoreply') !== null || h.get('x-autorespond') !== null) return true;
    if ((h.get('return-path') ?? '').replace(/\s/g, '') === '<>') return true;
    if (contentType === 'multipart/report') return true;
    if (fromAddress && /^(mailer-daemon|postmaster)@/i.test(fromAddress)) return true;
    return false;
}
