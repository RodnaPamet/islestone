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
    collidingRestoredRows,
    planRestoredSortKeys,
    type LiveSortKeyNeighbours,
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

/**
 * Restored rows (issue #110): a row back from a soft delete whose kept key a
 * live row now holds, or another restored row holds, gets a new key in its
 * old place. The neighbours are computed from the full live list as the
 * restore reads them (the live rows just before and after the row's
 * `(sortKey, id)`, stepping past live rows sharing a key).
 */
describe('fractional index — restored rows keep their place', () => {
    type Row = { id: string; sortKey: string };
    const byKeyId = (a: Row, b: Row) => cmp(a.sortKey, b.sortKey) || cmp(a.id, b.id);

    function neighboursFrom(live: readonly Row[], rows: readonly Row[], colliding: ReadonlySet<string>) {
        const sorted = [...live].sort(byKeyId);
        const out = new Map<string, LiveSortKeyNeighbours>();
        for (const r of rows.filter((x) => colliding.has(x.id))) {
            const before = sorted.filter((l) => byKeyId(l, r) < 0);
            const after = sorted.filter((l) => byKeyId(l, r) > 0);
            const prev = before[before.length - 1] ?? null;
            let next = after[0] ?? null;
            let i = 0;
            while (prev && next && next.sortKey === prev.sortKey) next = after[++i] ?? null;
            out.set(r.id, { prev: prev?.sortKey ?? null, next: next?.sortKey ?? null });
        }
        return out;
    }

    // Short keys from a small alphabet, so collisions between live and restored rows are common.
    const shortKey = fc
        .array(fc.constantFrom('1', '5', 'A', 'V', 'z'), { minLength: 1, maxLength: 3 })
        .map((d) => d.join(''));

    it('every key in the project is distinct afterwards, and the order is the order by (old key, id)', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(shortKey, { minLength: 0, maxLength: 12 }),
                fc.array(shortKey, { minLength: 1, maxLength: 8 }),
                (liveKeys, groupKeys) => {
                    const live = liveKeys.map((k, i) => ({ id: `l${String(i).padStart(2, '0')}`, sortKey: k }));
                    const rows = groupKeys.map((k, i) => ({ id: `g${String(i).padStart(2, '0')}`, sortKey: k }));
                    const colliding = collidingRestoredRows(rows, new Set(liveKeys));
                    const planned = planRestoredSortKeys(rows, colliding, neighboursFrom(live, rows, colliding));
                    expect([...planned.keys()].sort()).toEqual([...colliding].sort());
                    const after = [...live, ...rows.map((r) => ({ id: r.id, sortKey: planned.get(r.id) ?? r.sortKey }))];
                    expect(new Set(after.map((r) => r.sortKey)).size).toBe(after.length);
                    expect(after.every((r) => isValidSortKey(r.sortKey))).toBe(true);
                    const expected = [...live, ...rows].sort(byKeyId).map((r) => r.id);
                    expect([...after].sort((a, b) => cmp(a.sortKey, b.sortKey)).map((r) => r.id)).toEqual(expected);
                },
            ),
            { numRuns: 1500 },
        );
    });

    it('a restored row that collides with nothing keeps its key', () => {
        const rows = [{ id: 'g1', sortKey: 'V' }];
        expect(collidingRestoredRows(rows, new Set(['A', 'z'])).size).toBe(0);
        expect(planRestoredSortKeys(rows, new Set(), new Map()).size).toBe(0);
    });

    it('between two live rows that share its key, it goes after both', () => {
        const live = [{ id: 'a', sortKey: 'V' }, { id: 'c', sortKey: 'V' }, { id: 'd', sortKey: 'z' }];
        const rows = [{ id: 'b', sortKey: 'V' }];
        const colliding = collidingRestoredRows(rows, new Set(['V', 'z']));
        const key = planRestoredSortKeys(rows, colliding, neighboursFrom(live, rows, colliding)).get('b')!;
        expect('V' < key && key < 'z').toBe(true);
    });
});
