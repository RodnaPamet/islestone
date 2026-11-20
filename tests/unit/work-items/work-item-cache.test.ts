/**
 * The shared cache's placement rule (sub-phase 2.3): a changed row leaves the
 * lists it no longer matches, enters the ones it now matches at its order,
 * keeps its place where the client cannot tell, and is not added past the
 * loaded pages; the list's query string is stable for equal filters.
 */
import { compareRows, listQueryString, rowBelongs } from '@/components/work-items/data/list-filters';
import { placeRow, removeRowFromPages } from '@/components/work-items/data/work-item-cache';
import type { WorkItemPage, WorkItemRow } from '@/lib/work-items/types';

function row(id: string, over: Partial<WorkItemRow> = {}): WorkItemRow {
    return {
        id,
        key: id,
        number: 1,
        title: id,
        projectId: 'p1',
        teamId: 't1',
        typeId: 'ty1',
        stateId: 'todo',
        stateCategory: 'UNSTARTED',
        priority: 'NONE',
        assigneeId: null,
        createdByUserId: 'u-ada',
        parentId: null,
        cycleId: null,
        milestoneId: null,
        sortKey: 'm',
        startDate: null,
        dueDate: null,
        version: 1,
        labelIds: [],
        customFields: {},
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        ...over,
    };
}

const pages = (...groups: Array<{ rows: WorkItemRow[]; more?: boolean }>): WorkItemPage[] =>
    groups.map((g) => ({ items: g.rows, pageInfo: { hasNextPage: !!g.more } }));

const ids = (p: WorkItemPage[]) => p.flatMap((x) => x.items.map((r) => r.id));

describe('rowBelongs', () => {
    it('decides the facets the client can read and defers the rest', () => {
        expect(rowBelongs({ stateId: 'todo' }, row('a'))).toBe('yes');
        expect(rowBelongs({ stateId: 'done,todo' }, row('a'))).toBe('yes');
        expect(rowBelongs({ stateId: 'done' }, row('a'))).toBe('no');
        expect(rowBelongs({ assigneeId: 'none' }, row('a'))).toBe('yes');
        expect(rowBelongs({ assigneeId: 'none' }, row('a', { assigneeId: 'u1' }))).toBe('no');
        expect(rowBelongs({ labelId: 'l1' }, row('a', { labelIds: ['l1'] }))).toBe('yes');
        expect(rowBelongs({ q: 'x' }, row('a'))).toBe('unknown');
        expect(rowBelongs({ q: 'x', stateId: 'done' }, row('a'))).toBe('no');
    });
});

describe('placeRow', () => {
    it('moves a row out of the column it left and into the one it entered, at its order', () => {
        const todo = pages({ rows: [row('a', { sortKey: 'b' }), row('b', { sortKey: 'd' })] });
        const doing = pages({ rows: [row('c', { stateId: 'doing', sortKey: 'a' }), row('d', { stateId: 'doing', sortKey: 'e' })] });
        const moved = row('a', { stateId: 'doing', sortKey: 'c' });
        expect(ids(placeRow(todo, { stateId: 'todo', order: 'manual' }, moved))).toEqual(['b']);
        expect(ids(placeRow(doing, { stateId: 'doing', order: 'manual' }, moved))).toEqual(['c', 'a', 'd']);
    });

    it('keeps a row in place when the client cannot decide (free text)', () => {
        const list = pages({ rows: [row('a', { sortKey: 'b' }), row('b', { sortKey: 'd' })] });
        expect(ids(placeRow(list, { q: 'x', order: 'manual' }, row('a', { sortKey: 'z', title: 'renamed' })))).toEqual(['a', 'b']);
        expect(ids(placeRow(list, { q: 'x', order: 'manual' }, row('new')))).toEqual(['a', 'b']);
    });

    it('does not add a row that sorts after everything loaded while more pages exist', () => {
        const list = pages({ rows: [row('a', { sortKey: 'b' })], more: true });
        expect(ids(placeRow(list, { order: 'manual' }, row('z', { sortKey: 'zz' })))).toEqual(['a']);
        const complete = pages({ rows: [row('a', { sortKey: 'b' })] });
        expect(ids(placeRow(complete, { order: 'manual' }, row('z', { sortKey: 'zz' })))).toEqual(['a', 'z']);
    });

    it('orders "recently updated" lists newest first', () => {
        const list = pages({ rows: [row('a', { updatedAt: '2026-11-03T00:00:00.000Z' })] });
        const fresh = row('b', { updatedAt: '2026-11-05T00:00:00.000Z' });
        expect(ids(placeRow(list, { order: 'updated' }, fresh))).toEqual(['b', 'a']);
        expect(compareRows('manual', row('x', { sortKey: 'Z' }), row('y', { sortKey: 'a' }))).toBe(-1);
    });

    it('removes a row from every page', () => {
        expect(ids(removeRowFromPages(pages({ rows: [row('a')] }, { rows: [row('b')] }), 'b'))).toEqual(['a']);
    });
});

describe('listQueryString', () => {
    it('is the same for equal filters whatever their key order, and drops empty values', () => {
        expect(listQueryString({ stateId: 's', projectId: 'p', q: '' })).toBe(listQueryString({ projectId: 'p', stateId: 's' }));
        expect(listQueryString({ projectId: 'p' }, { limit: '50' })).toBe('projectId=p&limit=50');
    });
});
