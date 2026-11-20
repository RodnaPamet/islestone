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

export function htmlToText(html: string): string {
    let s = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
        // A quoted reply in HTML mail is a blockquote, or Gmail's quote block.
        .replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '\n- ')
        .replace(/<\/(p|div|tr|h[1-6]|table|ul|ol|section|article|header|footer)\s*>/gi, '\n')
        .replace(/<(p|div|tr|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    s = decodeEntities(s);
    return s
        .split('\n')
        .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
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
