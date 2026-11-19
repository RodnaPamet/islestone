/**
 * Property tests for the in-house fractional index (ADR 0002 §5, option F1;
 * owner decision 2026-11-19). Roadmap 2.1 asks for them. The Postgres half
 * (`COLLATE "C"` orders the keys as JavaScript `<` does) is in
 * tests/integration/work-item-graph.test.ts.
 */
import fc from 'fast-check';

import {
    InvalidSortKeyError,
    SORT_KEY_DIGITS,
    SORT_KEY_REBALANCE_LENGTH,
    isValidSortKey,
    keyBetween,
    keysBetween,
    needsRebalance,
} from '@/app-layer/domain/fractional-index';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A valid key: digits from the alphabet, never ending in '0'. */
const validKey = fc
    .array(fc.constantFrom(...SORT_KEY_DIGITS.split('')), { minLength: 1, maxLength: 12 })
    .map((d) => d.join(''))
    .filter((k) => !k.endsWith('0'));

describe('fractional index — properties', () => {
    it('a key between any two keys sorts strictly between them under <', () => {
        fc.assert(
            fc.property(validKey, validKey, (x, y) => {
                fc.pre(x !== y);
                const [a, b] = x < y ? [x, y] : [y, x];
                const k = keyBetween(a, b);
                return a < k && k < b && isValidSortKey(k);
            }),
            { numRuns: 2000 },
        );
    });

    it('open ends: before the first and after the last', () => {
        fc.assert(
            fc.property(validKey, (a) => {
                const after = keyBetween(a, null);
                const before = keyBetween(null, a);
                return a < after && before < a && isValidSortKey(after) && isValidSortKey(before);
            }),
            { numRuns: 1000 },
        );
    });

    it('random insert sequences keep every key unique and the list in the order the inserts asked for', () => {
        fc.assert(
            fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 200 }), (positions) => {
                const list: string[] = [];
                for (const p of positions) {
                    const at = p % (list.length + 1);
                    const k = keyBetween(list[at - 1] ?? null, list[at] ?? null);
                    list.splice(at, 0, k);
                }
                const sorted = [...list].sort(cmp);
                return new Set(list).size === list.length && sorted.every((k, i) => k === list[i]);
            }),
            { numRuns: 300 },
        );
    });

    it('keysBetween gives n increasing keys inside the gap', () => {
        fc.assert(
            fc.property(fc.option(validKey, { nil: null }), fc.integer({ min: 0, max: 50 }), (a, n) => {
                const keys = keysBetween(a, null, n);
                return keys.length === n && keys.every((k, i) => (i === 0 ? a === null || a < k : keys[i - 1]! < k));
            }),
            { numRuns: 500 },
        );
    });
});

describe('fractional index — the edges', () => {
    it('a first key is one digit, and 10,000 evenly spaced keys stay short', () => {
        expect(keyBetween(null, null)).toHaveLength(1);
        const keys = keysBetween(null, null, 10_000);
        expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(3);
    });

    it('repeated inserts into one gap grow the key, and the bound asks for a rebalance', () => {
        let a = 'V';
        const b = 'W';
        let grew = 0;
        while (!needsRebalance(a)) {
            a = keyBetween(a, b);
            grew += 1;
        }
        expect(a.length).toBe(SORT_KEY_REBALANCE_LENGTH + 1);
        expect(grew).toBeGreaterThan(SORT_KEY_REBALANCE_LENGTH);
    });

    it('refuses invalid or out-of-order input', () => {
        expect(() => keyBetween('b', 'a')).toThrow(InvalidSortKeyError);
        expect(() => keyBetween('a', 'a')).toThrow(InvalidSortKeyError);
        expect(() => keyBetween('a0', null)).toThrow(InvalidSortKeyError);
        expect(() => keyBetween('a-b', null)).toThrow(InvalidSortKeyError);
        expect(() => keyBetween('', null)).toThrow(InvalidSortKeyError);
        expect(() => keysBetween(null, null, -1)).toThrow(InvalidSortKeyError);
    });

    it('compares by code unit, never localeCompare (mixed case)', () => {
        const k = keyBetween('Z', 'a');
        expect('Z' < k && k < 'a').toBe(true);
    });
});
