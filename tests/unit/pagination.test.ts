/**
 * Keyset pagination (`src/lib/pagination.ts`): `clampLimit`, cursors over
 * `{ column, direction }` with an `id` tie-break, and forged cursors refused.
 *
 * The `clampLimit` cases follow inflect-compliance's
 * `tests/unit/pagination.test.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e;
 * the cursor cases are new (the source cursor was `(createdAt, id)` only).
 */
import fc from 'fast-check';

import {
    DEFAULT_LIMIT,
    InvalidCursorError,
    MAX_LIMIT,
    buildKeysetWhere,
    clampLimit,
    computeKeysetPage,
    decodeCursor,
    encodeCursor,
    keysetOrderBy,
    type KeysetOrder,
} from '@/lib/pagination';

const BY_KEY: KeysetOrder = { column: 'sortKey', direction: 'asc', kind: 'string' };
const BY_UPDATED: KeysetOrder = { column: 'updatedAt', direction: 'desc', kind: 'date' };

describe('clampLimit', () => {
    it.each([
        [undefined, DEFAULT_LIMIT],
        [null, DEFAULT_LIMIT],
        [Number.NaN, DEFAULT_LIMIT],
        [0, 1],
        [-5, 1],
        [7, 7],
        [MAX_LIMIT + 50, MAX_LIMIT],
        [3.7, 3],
    ])('clampLimit(%p) = %p', (input, expected) => {
        expect(clampLimit(input as number | null | undefined)).toBe(expected);
    });
});

describe('cursors', () => {
    it('round-trip', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 100 }), fc.string({ minLength: 1, maxLength: 40 }), (k, id) => {
                expect(decodeCursor(encodeCursor({ k, id }), BY_KEY)).toEqual({ k, id });
            }),
        );
    });

    it('a forged cursor is refused, never read as the first page', () => {
        for (const bad of ['', 'not-base64!!', Buffer.from('{"k":1}').toString('base64url'), Buffer.from('[]').toString('base64url')]) {
            expect(() => decodeCursor(bad, BY_KEY)).toThrow(InvalidCursorError);
        }
        expect(() => decodeCursor(encodeCursor({ k: 'not a date', id: 'x' }), BY_UPDATED)).toThrow(InvalidCursorError);
    });

    it('the keyset where breaks a tie on the key by id, ascending and descending', () => {
        expect(buildKeysetWhere(BY_KEY, { k: 'V', id: 'c1' })).toEqual({
            OR: [{ sortKey: { gt: 'V' } }, { sortKey: 'V', id: { gt: 'c1' } }],
        });
        const at = '2030-01-01T00:00:00.000Z';
        expect(buildKeysetWhere(BY_UPDATED, { k: at, id: 'c1' })).toEqual({
            OR: [{ updatedAt: { lt: new Date(at) } }, { updatedAt: new Date(at), id: { lt: 'c1' } }],
        });
        expect(keysetOrderBy(BY_KEY)).toEqual([{ sortKey: 'asc' }, { id: 'asc' }]);
    });

    it('paging an in-memory list with the same rule visits every row once, ties included', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 40 }), fc.integer({ min: 1, max: 7 }), (keys, limit) => {
                const rows = keys.map((k, i) => ({ id: `id${String(i).padStart(3, '0')}`, sortKey: k }));
                const sorted = [...rows].sort((x, y) => (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : x.id < y.id ? -1 : 1));
                const seen: string[] = [];
                let cursor: string | undefined;
                for (let guard = 0; guard < 100; guard++) {
                    const c = cursor ? decodeCursor(cursor, BY_KEY) : undefined;
                    const after = c ? sorted.filter((r) => r.sortKey > c.k || (r.sortKey === c.k && r.id > c.id)) : sorted;
                    const page = computeKeysetPage(after.slice(0, limit + 1), limit, BY_KEY);
                    seen.push(...page.items.map((r) => r.id));
                    cursor = page.pageInfo.nextCursor;
                    if (!page.pageInfo.hasNextPage) break;
                }
                expect(seen).toEqual(sorted.map((r) => r.id));
            }),
        );
    });
});
