/**
 * The Workload page's pure parts (sub-phases 3.5a and 3.5b): the grid's rows
 * (people in the server's order, then the "Unassigned" row with no capacity),
 * how full a week is, My Work's line (hidden without counted work in either
 * week), the roving focus and the dialog's working dates.
 */
import { fillRatio, rovingTarget, UNASSIGNED_ROW, workingDatesIn, workloadLine, workloadRows } from '@/components/workload/workload-model';
import type { WorkloadData } from '@/lib/workload/types';

const data: Pick<WorkloadData, 'weeks' | 'people' | 'unassigned'> = {
    weeks: ['2026-11-23', '2026-11-30'],
    people: [
        {
            userId: 'u-ada',
            name: '  ',
            active: true,
            capacity: [2400, 0],
            weeklyMinutes: [2400, 2400],
            timeOffMinutes: [0, 2400],
            timeOffDays: [[], ['2026-11-30']],
            allocated: [1200, 60],
            over: [0, 60],
            share: [600, 0],
            later: 30,
            noDates: { count: 1, minutes: 90 },
            notEstimated: 2,
            pointsWork: { count: 1, points: 3 },
        },
    ],
    unassigned: { allocated: [300, 0], share: null, later: 0, noDates: { count: 0, minutes: 0 } },
};

describe('the grid rows', () => {
    it('keep the server\'s order, name an unnamed member, and end with the "Unassigned" row', () => {
        const rows = workloadRows(data, { unnamed: 'Unnamed member', unassigned: 'Unassigned' });
        expect(rows.map((r) => [r.userId, r.name, r.unassigned])).toEqual([
            ['u-ada', 'Unnamed member', false],
            [UNASSIGNED_ROW, 'Unassigned', true],
        ]);
        expect(rows[0]!.cells[1]).toMatchObject({ allocatedMinutes: 60, capacityMinutes: 0, overMinutes: 60, shareMinutes: 0, timeOffDays: ['2026-11-30'] });
        expect(rows[1]!.cells.map((c) => [c.allocatedMinutes, c.overMinutes, c.capacityMinutes, c.shareMinutes])).toEqual([
            [300, 0, 0, null],
            [0, 0, 0, null],
        ]);
        expect(workloadRows({ ...data, unassigned: null }, { unnamed: '', unassigned: '' })).toHaveLength(1);
    });
});

describe('how full a week is', () => {
    it('is allocated over capacity, at most one, a week with no capacity and work full', () => {
        expect(fillRatio({ allocatedMinutes: 1200, capacityMinutes: 2400 })).toBe(0.5);
        expect(fillRatio({ allocatedMinutes: 3000, capacityMinutes: 2400 })).toBe(1);
        expect(fillRatio({ allocatedMinutes: 60, capacityMinutes: 0 })).toBe(1);
        expect(fillRatio({ allocatedMinutes: 0, capacityMinutes: 0 })).toBe(0);
    });
});

describe("My Work's line", () => {
    it('reads this week and next, and is hidden without counted work in either', () => {
        expect(workloadLine([{ allocatedMinutes: 2040, capacityMinutes: 2400, overMinutes: 0 }, { allocatedMinutes: 2760, capacityMinutes: 2400, overMinutes: 360 }])).toEqual([
            { week: 'this', allocated: 2040, capacity: 2400, over: 0 },
            { week: 'next', allocated: 2760, capacity: 2400, over: 360 },
        ]);
        expect(workloadLine([{ allocatedMinutes: 0, capacityMinutes: 2400, overMinutes: 0 }, { allocatedMinutes: 0, capacityMinutes: 2400, overMinutes: 0 }])).toBeNull();
    });
});

describe('the roving focus and the working dates', () => {
    it('moves within the grid and stops at its edges', () => {
        expect(rovingTarget('ArrowRight', 0, 1, 3, 2)).toEqual([0, 1]);
        expect(rovingTarget('End', 2, 0, 3, 12)).toEqual([2, 11]);
        expect(rovingTarget('x', 0, 0, 1, 1)).toBeNull();
    });

    it('lists the working weekdays of a range without its holidays', () => {
        expect(workingDatesIn('2026-11-27', '2026-12-02', [1, 2, 3, 4, 5], ['2026-12-01'])).toEqual(['2026-11-27', '2026-11-30', '2026-12-02']);
    });
});
