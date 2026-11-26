/**
 * Property fuzzing of intake email addresses (Hardening H2f;
 * docs/porting/maps/H2.md part 6; `src/lib/intake/email/address.ts`).
 *
 *   - the address parser accepts exactly `<token>@<domain>` and
 *     `<token>+r<replyToken>@<domain>` on the configured domain, the tokens
 *     from the token alphabet at their lengths, in any letter case and with
 *     surrounding whitespace; nothing else;
 *   - never a look-alike domain, and never a Unicode homoglyph of a token
 *     letter or of the domain (a character that lower-cases to ASCII);
 *   - an address found in a header list with any surrounding text (display
 *     names, quotes, comments, other addresses) parses as the same address;
 *   - reading a header list or a mailbox takes time linear in its length.
 */
import fc from 'fast-check';

import { ADDRESS_TOKEN_LENGTH, addressesIn, hasAsciiLookalike, mailboxOf, parseIntakeAddress, REPLY_TOKEN_LENGTH, TOKEN_ALPHABET } from '@/lib/intake/email/address';

import { assertFuzz, bestTimeMs, fuzzTimeout } from '../../../helpers/fuzz';

const DOMAIN = 'in.islestone.cloud';
const letter = fc.constantFrom(...TOKEN_ALPHABET.split(''));
const tokenArb = fc.string({ unit: letter, minLength: ADDRESS_TOKEN_LENGTH, maxLength: ADDRESS_TOKEN_LENGTH });
const replyArb = fc.string({ unit: letter, minLength: REPLY_TOKEN_LENGTH, maxLength: REPLY_TOKEN_LENGTH });
const randomCase = (s: string, flips: boolean[]) => [...s].map((c, i) => (flips[i % Math.max(1, flips.length)] ? c.toUpperCase() : c)).join('');
const flipsArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 40 });
const spaceArb = fc.string({ unit: fc.constantFrom(' ', '\t', '\n', '\r'), maxLength: 3 });

/** The reference grammar: ASCII only, compared after ASCII lower-casing. */
function referenceParse(address: string, domain: string): { token: string; replyToken: string | null } | null {
    const t = address.trim();
    if (!/^[\x21-\x7e]+$/.test(t)) return null;
    const lower = t.replace(/[A-Z]/g, (c) => c.toLowerCase());
    const m = new RegExp(`^([${TOKEN_ALPHABET}]{${ADDRESS_TOKEN_LENGTH}})(?:\\+r([${TOKEN_ALPHABET}]{${REPLY_TOKEN_LENGTH}}))?@(.+)$`).exec(lower);
    if (!m || m[3] !== domain) return null;
    return { token: m[1]!, replyToken: m[2] ?? null };
}

/** Characters that lower-case (in full Unicode) to an ASCII letter: K (Kelvin), İ, and friends. */
const homoglyphs = [...Array(0x10000).keys()]
    .map((c) => String.fromCharCode(c))
    .filter((c) => c.charCodeAt(0) > 0x7f && /[a-z]/.test(c.toLowerCase()));

describe('intake addresses (fuzzed)', () => {
    it(
        'parses an intake or reply address on the domain in any case and with surrounding whitespace',
        () => {
            assertFuzz(
                fc.property(tokenArb, fc.option(replyArb, { nil: null }), flipsArb, spaceArb, spaceArb, (token, reply, flips, before, after) => {
                    const address = `${token}${reply ? `+r${reply}` : ''}@${DOMAIN}`;
                    expect(parseIntakeAddress(before + randomCase(address, flips) + after, DOMAIN)).toEqual({ token, replyToken: reply });
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'accepts exactly what the reference grammar accepts, for any string',
        () => {
            const near = fc.tuple(tokenArb, fc.option(replyArb, { nil: null }), fc.string({ maxLength: 6 }), fc.nat(), fc.constantFrom(DOMAIN, `x${DOMAIN}`, `${DOMAIN}.evil.example`, 'in.islestone.c1oud', 'in-islestone.cloud', DOMAIN.toUpperCase())).map(
                ([token, reply, noise, at, domain]) => {
                    const s = `${token}${reply ? `+r${reply}` : ''}@${domain}`;
                    const i = at % (s.length + 1);
                    return s.slice(0, i) + noise + s.slice(i);
                },
            );
            assertFuzz(
                fc.property(fc.oneof(fc.string({ maxLength: 60 }), near), (s) => {
                    expect(parseIntakeAddress(s, DOMAIN)).toEqual(referenceParse(s, DOMAIN));
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'never matches when a token letter or a domain letter is a Unicode homoglyph',
        () => {
            assertFuzz(
                fc.property(tokenArb, fc.option(replyArb, { nil: null }), fc.constantFrom(...homoglyphs), fc.nat(), (token, reply, glyph, at) => {
                    const address = `${token}${reply ? `+r${reply}` : ''}@${DOMAIN}`;
                    const letters = [...address.matchAll(/[a-z]/g)].map((m) => m.index!);
                    const i = letters[at % letters.length]!;
                    fc.pre(glyph.toLowerCase().includes(address[i]!));
                    const forged = address.slice(0, i) + glyph + address.slice(i + 1);
                    expect(parseIntakeAddress(forged, DOMAIN)).toBeNull();
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'finds an address in a header list with any surrounding text, and parses it as the same address',
        () => {
            const nameArb = fc.string({ maxLength: 20 }).map((s) => s.replace(/[<>"\\,]/g, ''));
            const commentArb = fc.string({ maxLength: 20 }).map((s) => s.replace(/[()"\\]/g, ''));
            assertFuzz(
                fc.property(tokenArb, flipsArb, nameArb, commentArb, fc.constantFrom('angle', 'quoted', 'bare', 'comment'), fc.boolean(), (token, flips, name, comment, form, others) => {
                    const address = randomCase(`${token}@${DOMAIN}`, flips);
                    const mailbox =
                        form === 'angle' ? `${name} <${address}>` : form === 'quoted' ? `"${name}, ${name}" <${address}>` : form === 'comment' ? `${address} (${comment})` : address;
                    const list = others ? `other@example.com, ${mailbox}, "x, y" <third@example.org>` : mailbox;
                    const found = addressesIn(list).map((a) => parseIntakeAddress(a, DOMAIN)).filter((a) => a !== null);
                    expect(found).toEqual([{ token, replyToken: null }]);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'reads a header list or a mailbox in time linear in its length (no backtracking blow-up)',
        () => {
            const piece = fc.constantFrom('a', '@', '<', '>', '"', '(', ')', ',', ' ', '.', 'x@y', '\\');
            // A short prefix, then one short unit repeated to 20 KB, then a short suffix:
            // the shape that makes a backtracking pattern try every start in a long run.
            const hostile = fc
                .tuple(fc.array(piece, { maxLength: 2 }), fc.array(piece, { minLength: 1, maxLength: 2 }), fc.array(piece, { maxLength: 2 }), fc.integer({ min: 5_000, max: 20_000 }))
                .map(([pre, unit, post, n]) => pre.join('') + unit.join('').repeat(Math.ceil(n / unit.join('').length)) + post.join(''));
            assertFuzz(
                fc.property(fc.oneof(hostile, fc.string({ maxLength: 2_000 })), (value) => {
                    // 20 KB in 25 ms is about a microsecond a character: a quadratic read takes seconds.
                    expect(bestTimeMs(() => addressesIn(value), 25)).toBeLessThanOrEqual(25);
                    expect(bestTimeMs(() => mailboxOf(value), 25)).toBeLessThanOrEqual(25);
                }),
                { scale: 0.5 },
            );
        },
        fuzzTimeout(60, 0.5),
    );
});

describe('intake addresses: the one-pass reader answers as the patterns it replaced', () => {
    /** The reader before H2f, kept as the reference on inputs too short to blow up. */
    function legacyFlush(current: string): string | undefined {
        const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(current);
        return angle ? angle[1] : /([^\s<>"(),;:]+@[^\s<>"(),;:]+)/.exec(current)?.[1];
    }
    it(
        'finds the same address in any short ASCII header value with no quoted string or comment',
        () => {
            // Quotes and comments are left out: since H2f an address inside one is not
            // the address (the examples below), where the old reader took it.
            const piece = fc.constantFrom('a', 'B', '@', '<', '>', ',', ' ', '.', ';', ':', '\t', 'x@y');
            assertFuzz(
                // No commas: the list splitter then hands the whole value to one read.
                fc.property(fc.array(piece, { maxLength: 30 }).map((p) => p.join('').replace(/,/g, '')), (value) => {
                    const legacy = legacyFlush(value);
                    expect(addressesIn(value)).toEqual(legacy === undefined ? [] : [legacy.toLowerCase()]);
                }),
            );
        },
        fuzzTimeout(1),
    );
});

describe('intake addresses: examples the fuzzing found (H2f)', () => {
    it('refuses an address whose token or domain uses the Kelvin sign for k (seed -1472235035)', () => {
        expect(parseIntakeAddress('6a5a76kaaaaa@in.islestone.cloud', DOMAIN)).toEqual({ token: '6a5a76kaaaaa', replyToken: null });
        expect(parseIntakeAddress('6a5a76Kaaaaa@in.islestone.cloud', DOMAIN)).toBeNull();
        expect(parseIntakeAddress('abcdefghjkmn@in.islestone.cKoud'.replace('K', 'l'), DOMAIN)).not.toBeNull();
        expect(parseIntakeAddress('abcdefghjkmn@İn.islestone.cloud', DOMAIN)).toBeNull();
        // Through the webhook's own path: the header list keeps the sign, so the address does not resolve.
        expect(addressesIn('Support <6a5a76Kaaaaa@in.islestone.cloud>').map((a) => parseIntakeAddress(a, DOMAIN))).toEqual([null]);
    });

    it('takes no address from inside a comment or a quoted display name (seed -896877337)', () => {
        expect(addressesIn('aaaaaaaaaaaa@in.islestone.cloud (<#@#>)')).toEqual(['aaaaaaaaaaaa@in.islestone.cloud']);
        expect(addressesIn('"victim@corp.example <victim@corp.example>" <mallory@evil.example>')).toEqual(['mallory@evil.example']);
        expect(mailboxOf('"victim@corp.example" <mallory@evil.example>').address).toBe('mallory@evil.example');
        expect(addressesIn('"Lovelace, Ada" <Ada@Example.com>, bob@example.com (Bob, the builder)')).toEqual(['ada@example.com', 'bob@example.com']);
        // A quoted string or a comment left open reads as ordinary text.
        expect(addressesIn('"Ada <ada@x.io>')).toEqual(['ada@x.io']);
        expect(addressesIn('ada@x.io (unclosed')).toEqual(['ada@x.io']);
    });

    it('reads a long run with no @, or an unclosed bracket full of @, in linear time (seed 1113955024)', () => {
        expect(bestTimeMs(() => addressesIn('a'.repeat(20_000)), 25)).toBeLessThanOrEqual(25);
        expect(bestTimeMs(() => addressesIn(`<${'a@'.repeat(10_000)}`), 25)).toBeLessThanOrEqual(25);
        expect(bestTimeMs(() => mailboxOf(`"${'a'.repeat(20_000)}`), 25)).toBeLessThanOrEqual(25);
        expect(addressesIn(`<${'a@'.repeat(3)}`)).toEqual(['<a@a@a@'.slice(1)]);
    });
});

describe('intake addresses: look-alikes of ASCII (H2f)', () => {
    it(
        'flags exactly the addresses whose case folding reaches ASCII from outside it',
        () => {
            assertFuzz(
                fc.property(fc.string({ unit: 'grapheme', maxLength: 20 }), (s) => {
                    const folds = [...s].some((c) => c.charCodeAt(0) >= 0x80 && /[\x00-\x7f]/.test(c.toLowerCase() + c.toUpperCase()));
                    expect(hasAsciiLookalike(s)).toBe(folds);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it('flags the Kelvin sign and the long s, and never a plain or accented address', () => {
        expect(hasAsciiLookalike('Kate@example.com')).toBe(true);
        expect(hasAsciiLookalike('roſa@example.com')).toBe(true);
        expect(hasAsciiLookalike('kate@example.com')).toBe(false);
        expect(hasAsciiLookalike('jörg@münchen.example')).toBe(false);
    });
});
