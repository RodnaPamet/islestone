/**
 * My time's week grid as data (sub-phase 3.4b; `week-grid-model.ts`): rows by
 * item, cells summing finished entries, the shared rows for deleted and
 * hidden items, a running timer marked and counted nowhere.
 */
import { buildWeekGrid, type WeekEntry } from '@/components/time/week-grid-model';

const base = { userId: 'u', projectId: 'p', source: 'MANUAL' as const, billable: false, description: null, version: 1, createdAt: '', updatedAt: '' };
const item = (id: string, key: string) => ({ kind: 'visible' as const, id, key, title: key, projectId: 'p', closed: false });
const e = (id: string, workDate: string, minutes: number | null, it: WeekEntry['item']): WeekEntry => ({ ...base, id, workItemId: it.kind === 'visible' ? it.id : null, workDate, minutes, item: it });

describe('buildWeekGrid', () => {
    it('sums by item and day, orders keys naturally, puts the shared rows last, and counts no running timer', () => {
        const grid = buildWeekGrid({
            weekStart: '2026-11-23',
            entries: [
                e('1', '2026-11-23', 30, item('a', 'ISL-10')),
                e('2', '2026-11-23', 15, item('a', 'ISL-10')),
                e('3', '2026-11-24', 60, item('b', 'ISL-9')),
                e('4', '2026-11-25', null, item('b', 'ISL-9')),
                e('5', '2026-11-29', 5, { kind: 'deleted' }),
                e('6', '2026-11-26', 7, { kind: 'hidden' }),
            ],
        });
        expect(grid.rows.map((r) => r.key)).toEqual(['b', 'a', 'hidden', 'deleted']);
        expect(grid.rows[1]!.cells[0]).toMatchObject({ minutes: 45, timerOn: false });
        expect(grid.rows[1]!.cells[0]!.entries.map((x) => x.id)).toEqual(['1', '2']);
        expect(grid.rows[0]!.cells[2]).toMatchObject({ minutes: 0, timerOn: true, entries: [] });
        expect(grid.dayTotals).toEqual([45, 60, 0, 7, 0, 0, 5]);
        expect(grid.total).toBe(117);
        expect(grid.rows.map((r) => r.total)).toEqual([60, 45, 7, 5]);
    });

    it('is empty for an empty week', () => {
        expect(buildWeekGrid({ weekStart: '2026-11-23', entries: [] })).toEqual({ days: expect.any(Array), rows: [], dayTotals: [0, 0, 0, 0, 0, 0, 0], total: 0 });
    });
});
