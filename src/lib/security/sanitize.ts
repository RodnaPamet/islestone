/**
 * Server-side plain-text sanitisation — sub-phase 1.4 brings ONE profile.
 *
 * Copied from inflect-compliance `src/lib/security/sanitize.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: `sanitizePlainText` and its
 * entity decoder only, because the first free-text write path (the display
 * name, `src/lib/account/profile.ts`) needs it in 1.4. Sub-phase 1.5 ports
 * the rest of the file (the rich-text and URL profiles) into this module.
 *
 * `sanitize-html` runs natively on Node without a DOM polyfill.
 */
import sanitizeHtml from 'sanitize-html';

// ─── Plain-text profile ─────────────────────────────────────────────

/**
 * Decode the HTML entities an attacker could use to smuggle a `<` or `>`
 * past a tag-stripper: named (`&lt;`), decimal-numeric (`&#60;`) and
 * hex-numeric (`&#x3c;`). `&amp;` is decoded LAST so a single pass turns
 * `&amp;lt;` into `&lt;` (not `<`) — the caller loops, peeling one layer per
 * pass, so multi-level encodings still fully resolve. Invalid code points are
 * left verbatim rather than throwing.
 */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => codePointOrRaw(parseInt(hex, 16), m))
        .replace(/&#(\d+);/g, (m, dec: string) => codePointOrRaw(parseInt(dec, 10), m))
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;|&#x27;/gi, "'")
        .replace(/&#47;|&#x2f;/gi, '/')
        .replace(/&amp;/gi, '&');
}

function codePointOrRaw(cp: number, raw: string): string {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return raw;
    }
    return String.fromCodePoint(cp);
}

/**
 * Strip all HTML from a field that has NO formatting (title, label,
 * single-line description, comment body).
 *
 * SECURITY — entity order matters. The naive "strip tags, THEN decode
 * entities" is a stored-XSS double-unescape: `sanitize-html` leaves an
 * entity-encoded `&lt;script&gt;` untouched (it isn't a tag), and decoding
 * afterwards reconstitutes a live `<script>` — the exact element the
 * sanitiser exists to remove. So an attacker only has to pre-encode their
 * payload to defeat it.
 *
 * The fix DECODES FIRST, then strips, looping until the value stabilises so
 * that (a) `&lt;script&gt;` and even multi-level `&amp;lt;script&amp;gt;`
 * materialise into real tags and get removed, exactly like a raw
 * `<script>`, and (b) the final value, once decoded, can no longer form any
 * strippable tag (at the fixed point `sanitizeHtml(decode(x)) === x`, so
 * `decode(x)` is tag-free). Innocuous entities (`&amp;`, `&quot;`, `&#39;`)
 * still resolve to their readable characters.
 */
export function sanitizePlainText(input: string | null | undefined): string {
    if (input == null) return '';
    if (typeof input !== 'string') return '';

    const strip = (s: string) =>
        sanitizeHtml(decodeHtmlEntities(s), { allowedTags: [], allowedAttributes: {} });

    let current = input;
    let next = strip(current);
    // Peel one encoding layer per pass until stable. The bound is a backstop
    // against a pathological input; a handful of layers resolves any real one.
    for (let i = 0; next !== current && i < 8; i++) {
        current = next;
        next = strip(current);
    }
    if (next !== current) {
        // Did not converge — return the sanitiser's (entity-encoded, tag-free)
        // form, which is always safe, over a possibly-unsafe decode.
        return next;
    }
    // Fixed point: `current` is tag-free even after decoding, so the decoded
    // form is both safe AND the readable literal text.
    return decodeHtmlEntities(current);
}
