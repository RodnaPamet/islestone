/**
 * Keys such as `ISL-123` (ADR 0002 §4): format and parse round trip, NFKC
 * and case folding of the prefix, and the 32-bit bound on the number.
 */
import fc from 'fast-check';

import { MAX_KEY_NUMBER, formatKey, isValidKeyPrefix, normaliseKeyPrefix, parseKey } from '@/app-layer/domain/work-item-key';

const prefix = fc
    .tuple(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), fc.string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), minLength: 1, maxLength: 9 }))
    .map(([a, b]) => a + b);

describe('work-item keys', () => {
    it('format and parse round-trip', () => {
        fc.assert(
            fc.property(prefix, fc.integer({ min: 1, max: MAX_KEY_NUMBER }), (p, n) => {
                expect(isValidKeyPrefix(p)).toBe(true);
                expect(parseKey(formatKey(p, n))).toEqual({ prefix: p, number: n });
            }),
        );
    });

    it('folds case and full-width forms, and trims', () => {
        expect(parseKey('  isl-12 ')).toEqual({ prefix: 'ISL', number: 12 });
        expect(parseKey('ＩＳＬ－１２')).toEqual({ prefix: 'ISL', number: 12 });
        expect(normaliseKeyPrefix(' isl ')).toBe('ISL');
    });

    it('refuses what is not a key', () => {
        for (const raw of ['ISL', 'ISL-', 'ISL-0', '1SL-1', 'I-1', 'ISL-12a', 'ISLANDSTONE1-1', `ISL-${MAX_KEY_NUMBER + 1}`, 'ISL-99999999999']) {
            expect([raw, parseKey(raw)]).toEqual([raw, null]);
        }
        expect(isValidKeyPrefix('isl')).toBe(false);
        expect(isValidKeyPrefix('I')).toBe(false);
    });
});
