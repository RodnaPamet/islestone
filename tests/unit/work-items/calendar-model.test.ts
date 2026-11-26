/**
 * The calendar view's pure model and its client-side helpers (roadmap 3.3a):
 * the month grid's window, items, bands and markers by day, the shading, the
 * chips a person may move (the timeline's `editableRows`, never a second
 * rule), the move's dates (the due date moved, the start by the same number
 * of days), and a write placed in a cached calendar.
 */
import {
    addMonths,
    cyclesByDay,
    dayKind,
    gridWindow,
    itemsByDay,
    markersByDay,
    monthGridRange,
    monthOf,
    movableItems,
} from '@/components/work-items/calendar/calendar-model';
import {
    CALENDAR_MAX_DAYS,
    daysBetween,
    moveDueTo,
    placeRowInCalendar,
    removeRowFromCalendar,
    withCalendarDates,
    type CalendarItem,
    type CalendarResponse,
} from '@/lib/work-items/calendar';

const item = (over: Partial<CalendarItem> = {}): CalendarItem => ({
    id: 'w1',
    key: 'ISL-1',
    title: 'One',
    projectId: 'p1',
    teamId: 't1',
    typeId: 'type',
    stateCategory: 'UNSTARTED',
    assigneeId: null,
    parentId: null,
    cycleId: null,
    milestoneId: null,
    startDate: null,
    dueDate: '2026-03-10',
    version: 1,
    ...over,
});

const response = (over: Partial<CalendarResponse> = {}): CalendarResponse => ({
    from: '2026-02-23',
    to: '2026-04-05',
    asOf: '2026-03-04',
    items: [item()],
    noDueDate: 0,
    cycles: [],
    milestones: [],
    projects: [{ id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: null, archived: false }],
    calendar: { id: 'c1', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-03-03'] },
    omitted: [],
    truncated: [],
    ...over,
});

describe('the month grid', () => {
    it('covers 42 days from the week start (Monday) before the first of the month', () => {
        // March 2026 begins on a Sunday: the grid starts on Monday 23 February.
        expect(gridWindow(new Date('2026-03-15T00:00:00Z'))).toEqual({ from: '2026-02-23', to: '2026-04-05' });
        // June 2026 begins on a Monday: no leading days.
        expect(gridWindow(new Date('2026-06-01T00:00:00Z'))).toEqual({ from: '2026-06-01', to: '2026-07-12' });
        const { from, to } = monthGridRange(new Date('2026-02-10T00:00:00Z'));
        expect(Math.round((to.getTime() + 1 - from.getTime()) / 86_400_000)).toBe(42);
        expect(from.getUTCDay()).toBe(1);
    });

    it('every grid fits the read window, across a year of months', () => {
        for (let m = 0; m < 24; m++) {
            const w = gridWindow(addMonths(new Date('2026-01-01T00:00:00Z'), m));
            expect(daysBetween(w.from, w.to) + 1).toBe(42);
            expect(daysBetween(w.from, w.to) + 1).toBeLessThanOrEqual(CALENDAR_MAX_DAYS);
        }
    });

    it('moves by months and finds the month of a day', () => {
        expect(addMonths(new Date('2026-12-15T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
        expect(addMonths(new Date('2026-01-31T00:00:00Z'), -1).toISOString().slice(0, 10)).toBe('2025-12-01');
        expect(monthOf('2026-03-31').toISOString().slice(0, 10)).toBe('2026-03-01');
    });
});

describe('days', () => {
    const w = { from: '2026-02-23', to: '2026-04-05' };

    it('puts items on their due dates in the window, started first, then not started, then closed, then by key', () => {
        const byDay = itemsByDay(
            [
                item({ id: 'a', key: 'ISL-10', stateCategory: 'DONE' }),
                item({ id: 'b', key: 'ISL-9', stateCategory: 'BACKLOG' }),
                item({ id: 'c', key: 'ISL-2', stateCategory: 'STARTED' }),
                item({ id: 'd', key: 'ISL-11', stateCategory: 'BACKLOG' }),
                item({ id: 'out', dueDate: '2026-04-06' }),
                item({ id: 'none', dueDate: null }),
            ],
            w,
        );
        expect(byDay.get('2026-03-10')!.map((i) => i.id)).toEqual(['c', 'b', 'd', 'a']);
        expect([...byDay.keys()]).toEqual(['2026-03-10']);
    });

    it('spans each cycle over its days inside the window', () => {
        const byDay = cyclesByDay(
            [
                { id: 'c2', teamId: 't', number: 2, name: null, startsOn: '2026-04-01', endsOn: '2026-04-14' },
                { id: 'c1', teamId: 't', number: 1, name: 'Spring', startsOn: '2026-02-01', endsOn: '2026-02-24' },
            ],
            w,
        );
        expect(byDay.get('2026-02-23')!.map((c) => c.id)).toEqual(['c1']);
        expect(byDay.get('2026-02-24')!.map((c) => c.id)).toEqual(['c1']);
        expect(byDay.has('2026-02-25')).toBe(false);
        expect(byDay.get('2026-04-05')!.map((c) => c.id)).toEqual(['c2']);
        expect(byDay.has('2026-04-06')).toBe(false);
    });

    it('marks milestones and project due dates, milestones first', () => {
        const byDay = markersByDay(
            [{ id: 'm1', projectId: 'p1', name: 'Beta', dueDate: '2026-03-10' }],
            [
                { id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: '2026-03-10', archived: false },
                { id: 'p2', name: 'Later', keyPrefix: 'LAT', dueDate: '2026-05-01', archived: false },
            ],
            w,
        );
        expect(byDay.get('2026-03-10')).toEqual([
            { kind: 'milestone', id: 'm1', label: 'Beta', keyPrefix: 'ISL', milestoneId: 'm1' },
            { kind: 'project', id: 'p1', label: 'Platform', keyPrefix: 'ISL', milestoneId: null },
        ]);
        expect(byDay.size).toBe(1);
    });

    it('shades holidays and non-working weekdays of the scope calendar', () => {
        const cal = response().calendar;
        expect(dayKind('2026-03-03', cal)).toBe('holiday');
        expect(dayKind('2026-03-07', cal)).toBe('nonWorking');
        expect(dayKind('2026-03-04', cal)).toBeNull();
        expect(dayKind('2026-03-07', { ...cal, workingWeekdays: [1, 2, 3, 4, 5, 6] })).toBeNull();
    });
});

describe('the chips a person may move (3.1c\'s editableRows)', () => {
    const shown = { startDate: false, dueDate: false };
    const resp = response({
        items: [
            item({ id: 'open' }),
            item({ id: 'started', stateCategory: 'STARTED' }),
            item({ id: 'done', stateCategory: 'DONE' }),
            item({ id: 'cancelled', stateCategory: 'CANCELLED' }),
            item({ id: 'archived', projectId: 'p2' }),
            item({ id: 'hidden', typeId: 'hiding' }),
        ],
        projects: [
            { id: 'p1', name: 'Platform', keyPrefix: 'ISL', dueDate: null, archived: false },
            { id: 'p2', name: 'Old', keyPrefix: 'OLD', dueDate: null, archived: true },
        ],
    });

    it('open and started items of unarchived projects whose type shows the due date', () => {
        const ids = movableItems(resp, { canEdit: true, hiddenDates: (r) => (r.typeId === 'hiding' ? { startDate: false, dueDate: true } : shown) });
        expect([...ids].sort()).toEqual(['open', 'started']);
    });

    it('none for a caller who does not edit work items', () => {
        expect(movableItems(resp, { canEdit: false, hiddenDates: () => shown }).size).toBe(0);
    });
});

describe('the move\'s dates (decision 241)', () => {
    it('moves the due date and the start by the same number of calendar days', () => {
        expect(moveDueTo({ startDate: '2026-03-02', dueDate: '2026-03-05' }, '2026-03-12')).toEqual({ startDate: '2026-03-09', dueDate: '2026-03-12' });
        expect(moveDueTo({ startDate: '2026-03-02', dueDate: '2026-03-05' }, '2026-02-28')).toEqual({ startDate: '2026-02-25', dueDate: '2026-02-28' });
        expect(moveDueTo({ startDate: null, dueDate: '2026-03-05' }, '2026-03-07')).toEqual({ startDate: null, dueDate: '2026-03-07' });
        expect(moveDueTo({ startDate: '2026-03-02', dueDate: null }, '2026-03-07')).toEqual({ startDate: '2026-03-02', dueDate: '2026-03-07' });
    });

    it('across a month end and a leap day', () => {
        expect(moveDueTo({ startDate: '2028-02-27', dueDate: '2028-02-28' }, '2028-03-01')).toEqual({ startDate: '2028-02-29', dueDate: '2028-03-01' });
    });
});

describe('a write placed in a cached calendar', () => {
    const change = (over: Partial<CalendarItem> = {}) => {
        const { key: _k, projectId: _p, teamId: _t, typeId: _y, ...rest } = item(over);
        void _k;
        void _p;
        void _t;
        void _y;
        return rest;
    };

    it('takes the held row\'s new fields', () => {
        const next = placeRowInCalendar(response(), change({ title: 'Renamed', dueDate: '2026-03-20', version: 2 }), 'yes');
        expect(next!.items[0]).toMatchObject({ title: 'Renamed', dueDate: '2026-03-20', version: 2, key: 'ISL-1' });
    });

    it('keeps a held row moved out of the window (an undo can put it back), and drops one that no longer matches', () => {
        expect(placeRowInCalendar(response(), change({ dueDate: '2026-05-01' }), 'yes')!.items).toHaveLength(1);
        expect(placeRowInCalendar(response(), change(), 'no')!.items).toHaveLength(0);
    });

    it('asks for a re-read when a row it does not hold may now be due in its window', () => {
        expect(placeRowInCalendar(response(), change({ id: 'other', dueDate: '2026-03-11' }), 'unknown')).toBeNull();
        expect(placeRowInCalendar(response(), change({ id: 'other', dueDate: '2026-03-11' }), 'no')).toEqual(response());
        expect(placeRowInCalendar(response(), change({ id: 'other', dueDate: '2026-06-11' }), 'yes')).toEqual(response());
        expect(placeRowInCalendar(response(), change({ id: 'other', dueDate: null }), 'yes')).toEqual(response());
    });

    it('removes a row, and places new dates and versions for held rows only', () => {
        expect(removeRowFromCalendar(response(), 'w1')!.items).toEqual([]);
        expect(removeRowFromCalendar(response(), 'nope')).toBeNull();
        const moved = withCalendarDates(response(), [{ id: 'w1', startDate: '2026-03-01', dueDate: '2026-03-02', version: 4 }, { id: 'nope', startDate: null, dueDate: null }]);
        expect(moved.items).toEqual([item({ startDate: '2026-03-01', dueDate: '2026-03-02', version: 4 })]);
        const r = response();
        expect(withCalendarDates(r, [{ id: 'nope', startDate: null, dueDate: null }])).toBe(r);
    });
});
