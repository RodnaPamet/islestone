/**
 * The board's pure model (sub-phase 2.3): columns, lanes, the drop's
 * placement and the keyboard's moves, with property tests for the rules a
 * move must never break (fast-check, 2.1's dev dependency).
 */
import fc from 'fast-check';

import { keysBetween, SORT_KEY_DIGITS } from '@/app-layer/domain/fractional-index';
import {
    bySortKey,
    categoryColumns,
    laneKeyOf,
    lanesOf,
    nextTarget,
    placementFor,
    stateColumns,
    targetStateId,
    withPreview,
    type GrabDirection,
} from '@/components/work-items/board/board-model';
import type { ViewState, WorkItemRow } from '@/lib/work-items/types';

function row(id: string, over: Partial<WorkItemRow> = {}): WorkItemRow {
    return {
        id,
        key: id.toUpperCase(),
        number: 1,
        title: id,
        projectId: 'p1',
        teamId: 't1',
        typeId: 'ty1',
        stateId: 's1',
        stateCategory: 'UNSTARTED',
        priority: 'NONE',
        assigneeId: null,
        createdByUserId: 'u-ada',
        parentId: null,
        sortKey: 'a',
        startDate: null,
        dueDate: null,
        version: 1,
        labelIds: [],
        customFields: {},
        createdAt: '',
        updatedAt: '',
        ...over,
    };
}

const states: ViewState[] = [
    { id: 'done', teamId: 't1', name: 'Done', category: 'DONE', isDefault: false },
    { id: 'todo', teamId: 't1', name: 'Todo', category: 'UNSTARTED', isDefault: true },
    { id: 'review', teamId: 't1', name: 'In review', category: 'STARTED', isDefault: false },
    { id: 'backlog', teamId: 't1', name: 'Backlog', category: 'BACKLOG', isDefault: false },
    { id: 'doing', teamId: 't1', name: 'In progress', category: 'STARTED', isDefault: false },
];

describe('columns', () => {
    it('a project board has one column per state, grouped by category, keeping the workflow order inside one', () => {
        expect(stateColumns(states).map((c) => c.name)).toEqual(['Backlog', 'Todo', 'In review', 'In progress', 'Done']);
        expect(stateColumns(states)[0]!.filter).toEqual({ stateId: 'backlog' });
    });

    it('a board over several teams has one column per category, and a drop takes the item\'s own team\'s default state', () => {
        const cols = categoryColumns();
        expect(cols.map((c) => c.id)).toEqual(['BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED']);
        const started = cols.find((c) => c.id === 'STARTED')!;
        const defaults = (teamId: string) => (teamId === 't1' ? { id: 'doing', teamId, name: 'In progress', category: 'STARTED' as const, isDefault: true } : undefined);
        expect(targetStateId(started, { teamId: 't1' }, defaults)).toBe('doing');
        expect(targetStateId(started, { teamId: 't2' }, defaults)).toBeUndefined();
        expect(targetStateId(stateColumns(states)[1]!, { teamId: 't1' }, defaults)).toBe('todo');
    });
});

describe('lanes', () => {
    const ctx = { labelOrder: ['l2', 'l1'] };

    it('groups by each field, with the "no value" lane last and the config order kept', () => {
        const rows = [row('a', { assigneeId: 'u2' }), row('b'), row('c', { assigneeId: 'u1' })];
        expect(lanesOf(rows, 'assignee', ctx, ['u1', 'u2'])).toEqual(['u1', 'u2', '']);
        expect(lanesOf(rows, 'none', ctx, [])).toEqual(['']);
    });

    it('puts a row with several labels in the lane of its first label in the workspace order', () => {
        expect(laneKeyOf(row('a', { labelIds: ['l1', 'l2'] }), 'label', ctx)).toBe('l2');
        expect(laneKeyOf(row('a'), 'label', ctx)).toBe('');
    });
});

/** Sorted, distinct, valid keys for a column. */
const sortedKeys = fc.integer({ min: 0, max: 8 }).map((n) => keysBetween(null, null, n));

describe('placement — properties', () => {
    it('the optimistic key sorts strictly between the neighbours of the drop index', () => {
        fc.assert(
            fc.property(sortedKeys, fc.nat(), (keys, rawIndex) => {
                const cell = keys.map((k, i) => row(`r${i}`, { sortKey: k }));
                const index = cell.length === 0 ? 0 : rawIndex % (cell.length + 1);
                const placed = placementFor(cell, index, { projectId: 'p1', sortKey: 'zzz' });
                if (cell.length === 0) {
                    expect(placed).toEqual({});
                    return;
                }
                const prev = cell[index - 1];
                const next = cell[index];
                expect(placed.sortKey).toBeDefined();
                if (prev) expect(prev.sortKey < placed.sortKey!).toBe(true);
                if (next) expect(placed.sortKey! < next.sortKey).toBe(true);
                // The anchor sent is the neighbour above, or at the top the one below.
                if (prev) expect(placed).toMatchObject({ afterId: prev.id });
                else expect(placed).toMatchObject({ beforeId: next!.id });
                // Re-sorted with the new key, the row lands at the index.
                const after = [...cell, row('moved', { sortKey: placed.sortKey! })].sort(bySortKey);
                expect(after.findIndex((r) => r.id === 'moved')).toBe(index);
            }),
        );
    });

    it('never sends an anchor in another project', () => {
        const cell = [row('a', { projectId: 'p2', sortKey: 'a' }), row('b', { projectId: 'p1', sortKey: 'b' })];
        expect(placementFor(cell, 1, { projectId: 'p1', sortKey: 'z' })).toMatchObject({ beforeId: 'b' });
        expect(placementFor(cell, 0, { projectId: 'p3', sortKey: 'z' })).toEqual({});
    });

    it('keys compare byte-wise (COLLATE "C"), never with localeCompare', () => {
        // 'Z' < 'a' byte-wise, though a locale compare says otherwise.
        expect(SORT_KEY_DIGITS.indexOf('Z') < SORT_KEY_DIGITS.indexOf('a')).toBe(true);
        expect(bySortKey(row('x', { sortKey: 'Z' }), row('y', { sortKey: 'a' }))).toBe(-1);
    });
});

describe('keyboard moves — properties', () => {
    const direction = fc.constantFrom<GrabDirection>('up', 'down', 'left', 'right');

    it('a target always stays on the board, within the cell sizes', () => {
        fc.assert(
            fc.property(
                fc.array(fc.array(fc.nat({ max: 6 }), { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 6 }),
                fc.array(direction, { maxLength: 30 }),
                fc.boolean(),
                (sizes, moves, lanesMovable) => {
                    // sizes[column][lane] — every column has the same lane count.
                    const lanes = Math.min(...sizes.map((c) => c.length));
                    const cellSize = (c: number, l: number) => sizes[c]![l]!;
                    let target = { column: 0, lane: 0, index: 0 };
                    for (const m of moves) {
                        target = nextTarget(target, m, { columns: sizes.length, lanes, lanesMovable }, cellSize);
                        expect(target.column).toBeGreaterThanOrEqual(0);
                        expect(target.column).toBeLessThan(sizes.length);
                        expect(target.lane).toBeGreaterThanOrEqual(0);
                        expect(target.lane).toBeLessThan(lanes);
                        expect(target.index).toBeGreaterThanOrEqual(0);
                        expect(target.index).toBeLessThanOrEqual(cellSize(target.column, target.lane));
                        if (!lanesMovable) expect(target.lane).toBe(0);
                    }
                },
            ),
        );
    });

    it('down past a cell\'s end enters the next lane only when lanes are movable', () => {
        const size = () => 2;
        expect(nextTarget({ column: 0, lane: 0, index: 2 }, 'down', { columns: 1, lanes: 2, lanesMovable: true }, size)).toEqual({ column: 0, lane: 1, index: 0 });
        expect(nextTarget({ column: 0, lane: 0, index: 2 }, 'down', { columns: 1, lanes: 2, lanesMovable: false }, size)).toEqual({ column: 0, lane: 0, index: 2 });
    });

    it('the preview holds every card once, with the moved one at the index', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 8 }), fc.nat(), (n, rawIndex) => {
                const cell = Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
                const moved = { id: 'm' };
                const index = rawIndex % (n + 1);
                const preview = withPreview(cell, moved, index);
                expect(preview).toHaveLength(n + 1);
                expect(preview[index]).toBe(moved);
                expect(new Set(preview.map((x) => x.id)).size).toBe(n + 1);
            }),
        );
    });
});
