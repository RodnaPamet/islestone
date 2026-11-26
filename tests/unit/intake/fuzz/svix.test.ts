/**
 * Property fuzzing of the inbound email webhook's Svix signature (Hardening
 * H2f; docs/porting/maps/H2.md part 6; `src/lib/intake/email/svix.ts`).
 *
 *   - a delivery signed with the secret verifies, whichever position its
 *     entry takes among others in the header;
 *   - any change to the body, the id, the timestamp or the signature refuses;
 *   - any timestamp more than five minutes either side of now refuses.
 */
import fc from 'fast-check';

import { svixSignature, SVIX_TOLERANCE_SECONDS, verifySvixSignature } from '@/lib/intake/email/svix';

import { assertFuzz, fuzzTimeout } from '../../../helpers/fuzz';

const NOW = 1_800_000_000;
const secretArb = fc.uint8Array({ minLength: 24, maxLength: 32 }).map((b) => `whsec_${Buffer.from(b).toString('base64')}`);
const idArb = fc.oneof(fc.string({ minLength: 1, maxLength: 40 }), fc.stringMatching(/^msg_[A-Za-z0-9]{20,27}$/));
const bodyArb = fc.oneof(fc.string({ maxLength: 400 }), fc.json({ maxDepth: 4 }));
const skewArb = fc.integer({ min: -SVIX_TOLERANCE_SECONDS, max: SVIX_TOLERANCE_SECONDS });
/** Other entries a header may carry beside the real one (another version, another secret's signature). */
const otherEntryArb = fc.oneof(
    fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => `v1,${Buffer.from(b).toString('base64')}`),
    fc.string({ maxLength: 50 }).map((s) => `v2,${s}`),
    fc.string({ maxLength: 50 }).filter((s) => !s.includes(' ')),
);

describe('the Svix signature (fuzzed)', () => {
    it(
        'verifies a delivery signed with the secret, wherever its entry sits among others',
        () => {
            assertFuzz(
                fc.property(secretArb, idArb, bodyArb, skewArb, fc.array(otherEntryArb, { maxLength: 3 }), fc.nat(), (secret, id, body, skew, others, at) => {
                    const ts = String(NOW + skew);
                    const entry = `v1,${svixSignature(secret, id, ts, body)}`;
                    const list = [...others];
                    list.splice(at % (others.length + 1), 0, entry);
                    expect(verifySvixSignature({ secret, id, timestamp: ts, signature: list.join(' '), rawBody: body, nowSeconds: NOW })).toEqual({ ok: true });
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'refuses any change to the body, the id or the timestamp',
        () => {
            assertFuzz(
                fc.property(secretArb, idArb, idArb, bodyArb, bodyArb, skewArb, skewArb, (secret, id, otherId, body, otherBody, skew, otherSkew) => {
                    const ts = String(NOW + skew);
                    const signature = `v1,${svixSignature(secret, id, ts, body)}`;
                    const base = { secret, id, timestamp: ts, signature, rawBody: body, nowSeconds: NOW };
                    if (otherBody !== body) expect(verifySvixSignature({ ...base, rawBody: otherBody }).ok).toBe(false);
                    if (otherId !== id) expect(verifySvixSignature({ ...base, id: otherId }).ok).toBe(false);
                    if (otherSkew !== skew) expect(verifySvixSignature({ ...base, timestamp: String(NOW + otherSkew) }).ok).toBe(false);
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'refuses any change to the signature: a character replaced, added or removed anywhere in its value',
        () => {
            assertFuzz(
                fc.property(
                    secretArb,
                    idArb,
                    bodyArb,
                    fc.nat(),
                    fc.integer({ min: 0x21, max: 0x7e }),
                    fc.constantFrom('replace', 'insert', 'remove'),
                    (secret, id, body, at, code, how) => {
                        const ts = String(NOW);
                        const value = svixSignature(secret, id, ts, body);
                        const i = at % value.length;
                        const ch = String.fromCharCode(code);
                        const changed =
                            how === 'replace' ? value.slice(0, i) + ch + value.slice(i + 1) : how === 'insert' ? value.slice(0, i) + ch + value.slice(i) : value.slice(0, i) + value.slice(i + 1);
                        fc.pre(changed !== value);
                        expect(verifySvixSignature({ secret, id, timestamp: ts, signature: `v1,${changed}`, rawBody: body, nowSeconds: NOW }).ok).toBe(false);
                    },
                ),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'refuses any timestamp more than five minutes either side of now, correctly signed or not',
        () => {
            assertFuzz(
                fc.property(secretArb, idArb, bodyArb, fc.integer({ min: SVIX_TOLERANCE_SECONDS + 1, max: 10 * 365 * 86_400 }), fc.boolean(), (secret, id, body, off, future) => {
                    const ts = String(future ? NOW + off : NOW - off);
                    const signature = `v1,${svixSignature(secret, id, ts, body)}`;
                    expect(verifySvixSignature({ secret, id, timestamp: ts, signature, rawBody: body, nowSeconds: NOW })).toEqual({ ok: false, reason: 'STALE_TIMESTAMP' });
                }),
            );
        },
        fuzzTimeout(1),
    );
});

describe('the Svix signature: examples the fuzzing found (H2f)', () => {
    it('refuses a signature with a character inserted that a base64 decoder skips (seed 1588519122)', () => {
        const secret = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // pragma: allowlist secret — a test secret of zeros
        const value = svixSignature(secret, ' ', String(NOW), '{}');
        const check = (v: string) => verifySvixSignature({ secret, id: ' ', timestamp: String(NOW), signature: `v1,${v}`, rawBody: '{}', nowSeconds: NOW });
        expect(check(value)).toEqual({ ok: true });
        expect(check(`!${value}`)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        expect(check(`${value.slice(0, 10)}\u0000${value.slice(10)}`)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        expect(check(value.replace(/=$/, ''))).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });
});
