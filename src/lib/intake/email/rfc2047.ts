/**
 * RFC 2047 encoded-word decoding (sub-phase 2.6c): `=?utf-8?B?…?=` and
 * `=?iso-8859-1?Q?…?=` in a header, adjacent encoded words joined without the
 * whitespace between them. An unknown charset decodes as UTF-8 with
 * replacement characters rather than failing the message. Pure; written fresh
 * for Islestone.
 */

const UTF8 = new TextDecoder('utf-8');
/**
 * Decoders by label, an unknown label mapped to UTF-8. Building a decoder for
 * an unknown label throws, and a header of thousands of encoded words naming
 * one threw thousands of times (Hardening H2f's fuzzing). Bounded: labels are
 * the sender's to choose.
 */
const decoders = new Map<string, TextDecoder>();
const MAX_CACHED_LABELS = 256;

function decoderFor(label: string): TextDecoder {
    const cached = decoders.get(label);
    if (cached) return cached;
    let decoder = UTF8;
    try {
        decoder = new TextDecoder(label === 'us-ascii' ? 'utf-8' : label);
    } catch {
        // an unknown charset decodes as UTF-8 with replacement characters
    }
    if (decoders.size < MAX_CACHED_LABELS) decoders.set(label, decoder);
    return decoder;
}

export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
    return decoderFor((charset || 'utf-8').trim().toLowerCase()).decode(bytes);
}

function decodeQ(text: string): Uint8Array {
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === '_') bytes.push(0x20);
        else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
            bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
            i += 2;
        } else bytes.push(c.charCodeAt(0) & 0xff);
    }
    return Uint8Array.from(bytes);
}

const WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

export function decodeEncodedWords(value: string): string {
    // Whitespace between two encoded words is not part of the text.
    const joined = value.replace(/(\?=)\s+(?==\?)/g, '$1');
    return joined.replace(WORD, (_all, charset: string, enc: string, text: string) => {
        const cs = charset.split('*')[0];
        const bytes = enc.toUpperCase() === 'B' ? Uint8Array.from(Buffer.from(text, 'base64')) : decodeQ(text);
        return decodeCharset(bytes, cs);
    });
}
