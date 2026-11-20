/**
 * The multi-column keyset of sub-phase 2.4 (`buildSortWhere`,
 * `sortOrderBy`, `computeSortPage` in `src/lib/pagination.ts`): over random
 * rows with nullable and tied values, paging with each page's cursor gives
 * exactly the full order (no repeat, no gap), nulls last in both directions.
 * The `where` and `orderBy` it builds are evaluated here by a small
 * interpreter of the shapes it emits, so the test reads what Prisma is sent.
 */
import fc from 'fast-check';

import {
    InvalidCursorError,
    buildSortWhere,
    computeSortPage,
    decodeSortCursor,
    encodeSortCursor,
    sortOrderBy,
    type SortSpec,
} from '@/lib/pagination';
import { listSortSpec } from '@/app-layer/repositories/WorkItemRepository';

type Row = { id: string; a: number | null; b: string; project: { keyPrefix: string } };

function get(row: Record<string, unknown>, key: string): unknown {
    return row[key];
}

/** Evaluate the where shapes `buildSortWhere` emits. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
        if (key === 'AND') return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
        const value = get(row, key);
        if (cond === null) return value === null || value === undefined;
        if (typeof cond === 'object' && !Array.isArray(cond)) {
            const c = cond as Record<string, unknown>;
            if ('gt' in c) return value !== null && value !== undefined && (value as number) > (c.gt as number);
            if ('lt' in c) return value !== null && value !== undefined && (value as number) < (c.lt as number);
            return matches(value as Record<string, unknown>, c);
        }
        return value === cond;
    });
}

function comparator(order: Array<Record<string, unknown>>) {
    return (x: Record<string, unknown>, y: Record<string, unknown>): number => {
        for (const term of order) {
            let [key, spec] = Object.entries(term)[0]!;
            let vx = get(x, key);
            let vy = get(y, key);
            while (spec && typeof spec === 'object' && !('sort' in (spec as object))) {
                [key, spec] = Object.entries(spec as Record<string, unknown>)[0]!;
                vx = get(vx as Record<string, unknown>, key);
                vy = get(vy as Record<string, unknown>, key);
            }
            const dir = typeof spec === 'string' ? spec : (spec as { sort: string }).sort;
            if (vx === vy) continue;
            if (vx === null) return 1;
            if (vy === null) return -1;
            const c = (vx as number) < (vy as number) ? -1 : 1;
            return dir === 'asc' ? c : -c;
        }
        return 0;
    };
}

function pageAll(rows: Row[], spec: SortSpec, limit: number): string[] {
    const order = sortOrderBy(spec);
    const sorted = [...rows].sort(comparator(order) as (a: Row, b: Row) => number);
    const out: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 500; guard += 1) {
        const candidates = cursor ? sorted.filter((r) => matches(r as unknown as Record<string, unknown>, buildSortWhere(spec, decodeSortCursor(cursor!, spec)))) : sorted;
        const page = computeSortPage(candidates.slice(0, limit + 1), limit, spec);
        out.push(...page.items.map((r) => r.id));
        if (!page.pageInfo.hasNextPage) break;
        cursor = page.pageInfo.nextCursor;
    }
    return out;
}

const rowsArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 9999 }), { minLength: 0, maxLength: 30 })
    .chain((idNums) =>
        fc.tuple(
            ...idNums.map((n) =>
                fc.record({
                    id: fc.constant(`id${String(n).padStart(4, '0')}`),
                    a: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
                    b: fc.constantFrom('x', 'y'),
                    project: fc.record({ keyPrefix: fc.constantFrom('AAA', 'BBB') }),
                }),
            ),
        ),
    );

describe('multi-column keyset', () => {
    it.each(['asc', 'desc'] as const)('a nullable column, %s: pages concatenate to the full order, nulls last', (direction) => {
        const spec: SortSpec = { columns: [{ path: ['a'], direction, kind: 'number', nullable: true }] };
        fc.assert(
            fc.property(rowsArb, fc.integer({ min: 1, max: 5 }), (rows, limit) => {
                const full = [...(rows as Row[])].sort(comparator(sortOrderBy(spec)) as (a: Row, b: Row) => number).map((r) => r.id);
                const paged = pageAll(rows as Row[], spec, limit);
                expect(paged).toEqual(full);
                const firstNull = full.findIndex((id) => (rows as Row[]).find((r) => r.id === id)!.a === null);
                if (firstNull >= 0) expect(full.slice(firstNull).every((id) => (rows as Row[]).find((r) => r.id === id)!.a === null)).toBe(true);
            }),
            { numRuns: 150 },
        );
    });

    it('two columns, one through a relation (the key sort)', () => {
        const spec: SortSpec = {
            columns: [
                { path: ['project', 'keyPrefix'], direction: 'desc', kind: 'string' },
                { path: ['b'], direction: 'desc', kind: 'string' },
            ],
        };
        fc.assert(
            fc.property(rowsArb, fc.integer({ min: 1, max: 4 }), (rows, limit) => {
                const full = [...(rows as Row[])].sort(comparator(sortOrderBy(spec)) as (a: Row, b: Row) => number).map((r) => r.id);
                expect(pageAll(rows as Row[], spec, limit)).toEqual(full);
            }),
            { numRuns: 100 },
        );
    });

    it('a cursor is refused when it does not fit its sort', () => {
        const spec = listSortSpec('due');
        expect(() => decodeSortCursor('garbage', spec)).toThrow(InvalidCursorError);
        expect(() => decodeSortCursor(encodeSortCursor({ v: ['x', 'y'], id: 'a' }), spec)).toThrow(InvalidCursorError);
        expect(() => decodeSortCursor(encodeSortCursor({ v: ['not a date'], id: 'a' }), spec)).toThrow(InvalidCursorError);
        expect(() => decodeSortCursor(encodeSortCursor({ v: [null], id: 'a' }), listSortSpec('created'))).toThrow(InvalidCursorError);
        expect(decodeSortCursor(encodeSortCursor({ v: [null], id: 'a' }), spec)).toEqual({ v: [null], id: 'a' });
    });

    it('the named sorts: direction defaults, manual ignores a direction, due is nullable, key is two columns', () => {
        expect(listSortSpec('manual', 'desc').columns).toEqual([{ path: ['sortKey'], direction: 'asc', kind: 'string', nullable: false }]);
        expect(listSortSpec('updated').columns[0]!.direction).toBe('desc');
        expect(listSortSpec('priority').columns[0]).toMatchObject({ path: ['priorityRank'], direction: 'asc' });
        expect(listSortSpec('due').columns[0]).toMatchObject({ nullable: true });
        expect(listSortSpec('key', 'desc').columns.map((c) => c.path.join('.'))).toEqual(['project.keyPrefix', 'number']);
        expect(sortOrderBy(listSortSpec('due'))).toEqual([{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
    });
});
