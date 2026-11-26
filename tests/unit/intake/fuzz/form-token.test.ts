/**
 * Property fuzzing of a public form's bot defence (Hardening H2f;
 * docs/porting/maps/H2.md part 6): the signed form token
 * (`src/lib/intake/public/form-token.ts`) and the proof-of-work
 * (`src/lib/intake/pow.ts`).
 *
 *   - a token with any single byte changed never verifies;
 *   - a token of another form or another version never verifies (a form's
 *     public id is unique across workspaces, so another workspace is another
 *     form); one younger than three seconds or older than a day never does;
 *   - a counter that does not solve the proof-of-work never verifies, and no
 *     value that is not a counter in range does either;
 *   - verifying takes bounded time for any input length.
 */
import { createHash } from 'node:crypto';

import fc from 'fast-check';

import { INTAKE_POW_BITS, INTAKE_POW_MAX_COUNTER, leadingZeroBits } from '@/lib/intake/pow';
import { FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS, issueFormToken, verifyFormToken, verifyProofOfWork } from '@/lib/intake/public/form-token';

import { assertFuzz, bestTimeMs, fuzzTimeout } from '../../../helpers/fuzz';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
/** base64url's alphabet, in its value order. */
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const publicIdArb = fc.string({ unit: fc.constantFrom(...ID_ALPHABET.split('')), minLength: 22, maxLength: 22 });
const versionArb = fc.integer({ min: 1, max: 999_999_999 });
const NOW = 1_800_000_000_000;
const ageArb = fc.integer({ min: FORM_TOKEN_MIN_AGE_MS, max: FORM_TOKEN_MAX_AGE_MS });

/** The leading zero bits of a digest, counted bit by bit (the reference for `leadingZeroBits`). */
function zeroBitsByString(digest: Uint8Array): number {
    const bits = [...digest].map((b) => b.toString(2).padStart(8, '0')).join('');
    const one = bits.indexOf('1');
    return one < 0 ? bits.length : one;
}

describe('the signed form token (fuzzed)', () => {
    it(
        'verifies as issued, for any form, version and age within the window',
        () => {
            assertFuzz(
                fc.property(publicIdArb, versionArb, ageArb, (id, version, age) => {
                    const token = issueFormToken(id, version, NOW - age);
                    expect(verifyFormToken(token, id, version, NOW)).toMatchObject({ ok: true, definitionVersion: version, issuedAt: NOW - age });
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'never verifies with any single byte changed',
        () => {
            assertFuzz(
                fc.property(publicIdArb, versionArb, ageArb, fc.nat(), fc.integer({ min: 0, max: 255 }), (id, version, age, at, byte) => {
                    const token = issueFormToken(id, version, NOW - age);
                    const i = at % token.length;
                    fc.pre(token.charCodeAt(i) !== byte);
                    const changed = token.slice(0, i) + String.fromCharCode(byte) + token.slice(i + 1);
                    expect(verifyFormToken(changed, id, version, NOW).ok).toBe(false);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'never verifies with anything appended, removed or replaced at its end',
        () => {
            assertFuzz(
                fc.property(publicIdArb, versionArb, ageArb, fc.string({ minLength: 1, maxLength: 8, unit: 'binary-ascii' }), fc.integer({ min: 1, max: 8 }), (id, version, age, extra, cut) => {
                    const token = issueFormToken(id, version, NOW - age);
                    expect(verifyFormToken(token + extra, id, version, NOW).ok).toBe(false);
                    expect(verifyFormToken(token.slice(0, -cut), id, version, NOW).ok).toBe(false);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        "never verifies for another form or another version, or outside the age window",
        () => {
            assertFuzz(
                fc.property(publicIdArb, publicIdArb, versionArb, versionArb, ageArb, fc.integer({ min: 1, max: 10 * FORM_TOKEN_MAX_AGE_MS }), (id, other, version, otherVersion, age, off) => {
                    const token = issueFormToken(id, version, NOW - age);
                    if (other !== id) expect(verifyFormToken(token, other, version, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
                    if (otherVersion !== version) expect(verifyFormToken(token, id, otherVersion, NOW)).toEqual({ ok: false, reason: 'STALE_FORM' });
                    // Too young: issued less than three seconds ago (or in the future).
                    const young = issueFormToken(id, version, NOW - (off % FORM_TOKEN_MIN_AGE_MS));
                    expect(verifyFormToken(young, id, version, NOW)).toEqual({ ok: false, reason: 'TOO_FAST' });
                    // Too old: issued more than a day ago.
                    const old = issueFormToken(id, version, NOW - FORM_TOKEN_MAX_AGE_MS - off);
                    expect(verifyFormToken(old, id, version, NOW)).toEqual({ ok: false, reason: 'EXPIRED' });
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'refuses any string that is not one of its own tokens, in bounded time',
        () => {
            assertFuzz(
                fc.property(publicIdArb, fc.oneof(fc.string({ maxLength: 300 }), fc.string({ unit: 'binary', maxLength: 70_000 })), (id, s) => {
                    expect(verifyFormToken(s, id, 1, NOW).ok).toBe(false);
                    expect(bestTimeMs(() => verifyFormToken(s, id, 1, NOW), 5)).toBeLessThanOrEqual(5);
                }),
                { scale: 0.5 },
            );
        },
        fuzzTimeout(5, 0.5),
    );
});

describe('the proof-of-work (fuzzed)', () => {
    it(
        'counts leading zero bits as a bit-by-bit count does',
        () => {
            assertFuzz(
                fc.property(fc.uint8Array({ maxLength: 40 }), (digest) => {
                    expect(leadingZeroBits(digest)).toBe(zeroBitsByString(digest));
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'verifies exactly the counters in range whose hash meets the difficulty, and nothing that is not a counter',
        () => {
            const counterArb = fc.oneof(
                fc.integer({ min: 0, max: INTAKE_POW_MAX_COUNTER }),
                fc.integer({ min: 0, max: 100_000 }),
                fc.constantFrom(-1, INTAKE_POW_MAX_COUNTER + 1, 0.5, Number.NaN, Infinity, -0, 2 ** 53),
                fc.anything(),
            );
            assertFuzz(
                fc.property(fc.string({ maxLength: 200 }), counterArb, (token, counter) => {
                    const isCounter = typeof counter === 'number' && Number.isInteger(counter) && counter >= 0 && counter <= INTAKE_POW_MAX_COUNTER;
                    const solves = isCounter && zeroBitsByString(new Uint8Array(createHash('sha256').update(`${token}:${counter}`).digest())) >= INTAKE_POW_BITS;
                    expect(verifyProofOfWork(token, counter)).toBe(solves);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'verifies in bounded time for any token length up to the submit body cap',
        () => {
            assertFuzz(
                fc.property(fc.string({ unit: 'binary', maxLength: 64 * 1024 }), fc.nat(), (token, counter) => {
                    expect(bestTimeMs(() => verifyProofOfWork(token, counter), 5)).toBeLessThanOrEqual(5);
                }),
                { scale: 0.5 },
            );
        },
        fuzzTimeout(5, 0.5),
    );
});

describe('the signed form token: examples the fuzzing found (H2f)', () => {
    it('refuses a token whose signature is a different spelling of the same bytes (seed -1561511906)', () => {
        // The signature is 32 bytes, 43 base64url characters: the last one
        // carries two bits no byte uses, and Node's decoder ignores a
        // character outside the alphabet. Both spellings decoded to the
        // signature's bytes, so a changed token verified.
        const token = issueFormToken('abcdefghijklmnopqrstuv', 1, NOW - 10_000);
        const last = token.at(-1)!;
        const sameBytes = B64URL[B64URL.indexOf(last) ^ 1]!;
        expect(verifyFormToken(token.slice(0, -1) + sameBytes, 'abcdefghijklmnopqrstuv', 1, NOW).ok).toBe(false);
        expect(verifyFormToken(`${token}!`, 'abcdefghijklmnopqrstuv', 1, NOW).ok).toBe(false);
        expect(verifyFormToken(`${token}=`, 'abcdefghijklmnopqrstuv', 1, NOW).ok).toBe(false);
    });
});
