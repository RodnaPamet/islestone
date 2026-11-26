/**
 * The engine's spans (roadmap 3.2c; owner decisions 185, 186 and 215): one
 * item's planned days as the engine reads its stored dates, the summary span,
 * and the same span from the four boundary dates the roadmap's aggregate
 * returns. Fixed vectors first, then the property the roadmap stands on:
 * `spanFromBounds(boundsOf(items))` equals `spanOf(items.map(plannedSpanOf))`
 * on any calendar, so the aggregate never has to load an item.
 */
import fc from 'fast-check';

import { compileCalendar, defaultCalendar, fromEpochDay, toEpochDay, type IsoWeekday } from '@/app-layer/domain/schedule/calendar';
import { computeSchedule } from '@/app-layer/domain/schedule/engine';
import { boundsOf, mergeBounds, plannedSpanOf, spanFromBounds, spanOf, type PlannedDates } from '@/app-layer/domain/schedule/span';

const d = toEpochDay;
const cal = defaultCalendar(); // Monday to Friday
const show = (s: { start: number; end: number } | null) => (s ? `${fromEpochDay(s.start)}..${fromEpochDay(s.end)}` : null);

describe('plannedSpanOf: the stored dates as the engine reads them (decision 185)', () => {
    it('both dates: from the start to the due date', () => {
        expect(show(plannedSpanOf({ startDate: d('2026-12-01'), dueDate: d('2026-12-10') }, cal))).toBe('2026-12-01..2026-12-10');
    });
    it('only a due date: one working day ending on it', () => {
        expect(show(plannedSpanOf({ startDate: null, dueDate: d('2026-12-02') }, cal))).toBe('2026-12-02..2026-12-02');
        // A Sunday due date: the working day is the Friday before it.
        expect(show(plannedSpanOf({ startDate: null, dueDate: d('2026-12-06') }, cal))).toBe('2026-12-04..2026-12-06');
    });
    it('only a start date: one working day from it', () => {
        expect(show(plannedSpanOf({ startDate: d('2026-12-02'), dueDate: null }, cal))).toBe('2026-12-02..2026-12-02');
        // A Saturday start: the working day is the Monday after it.
        expect(show(plannedSpanOf({ startDate: d('2026-12-05'), dueDate: null }, cal))).toBe('2026-12-05..2026-12-07');
    });
    it('start after due: one working day ending on the due date (DATES_REVERSED)', () => {
        expect(show(plannedSpanOf({ startDate: d('2026-12-20'), dueDate: d('2026-12-02') }, cal))).toBe('2026-12-02..2026-12-02');
    });
    it('neither date: no span ("No dates")', () => {
        expect(plannedSpanOf({ startDate: null, dueDate: null }, cal)).toBeNull();
    });
});

describe('spanOf: the one summary rule', () => {
    it('is the earliest start to the latest end, and null for nothing', () => {
        expect(spanOf([])).toBeNull();
        expect(spanOf([null, undefined])).toBeNull();
        expect(spanOf([{ start: 5, end: 9 }, null, { start: 2, end: 6 }, { start: 7, end: 12 }])).toEqual({ start: 2, end: 12 });
    });

    it('is what the engine draws a summary with (decision 186)', () => {
        const r = computeSchedule({
            asOf: d('2026-11-30'),
            calendars: [{ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
            items: [
                { id: 'p', calendarId: 'c', parentId: null, plannedStart: null, plannedFinish: null, status: 'open', actualStart: null, actualFinish: null, milestoneDue: null, projectDue: null },
                { id: 'a', calendarId: 'c', parentId: 'p', plannedStart: d('2026-12-01'), plannedFinish: d('2026-12-03'), status: 'open', actualStart: null, actualFinish: null, milestoneDue: null, projectDue: null },
                { id: 'b', calendarId: 'c', parentId: 'p', plannedStart: d('2026-12-07'), plannedFinish: d('2026-12-09'), status: 'open', actualStart: null, actualFinish: null, milestoneDue: null, projectDue: null },
            ],
            edges: [],
        });
        if (!r.ok) throw new Error('no schedule');
        const p = r.items.find((i) => i.id === 'p')!;
        const leaves = r.items.filter((i) => i.id !== 'p').map((i) => ({ start: i.earliestStart, end: i.earliestFinish }));
        expect({ start: p.earliestStart, end: p.earliestFinish }).toEqual(spanOf(leaves));
    });
});

describe('spanFromBounds: the aggregate needs only four dates', () => {
    it('vectors', () => {
        const items: PlannedDates[] = [
            { startDate: d('2026-12-08'), dueDate: d('2026-12-10') },
            { startDate: null, dueDate: d('2026-12-06') }, // Sunday: one working day ending on it, from Friday the 4th
            { startDate: d('2026-12-19'), dueDate: null }, // Saturday: to Monday the 21st
            { startDate: null, dueDate: null },
        ];
        expect(show(spanFromBounds(boundsOf(items), cal))).toBe('2026-12-04..2026-12-21');
        expect(spanFromBounds(boundsOf([{ startDate: null, dueDate: null }]), cal)).toBeNull();
    });

    const calendarArb = fc
        .record({
            weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
            holidays: fc.uniqueArray(fc.integer({ min: 0, max: 200 }), { maxLength: 20 }),
        })
        .map(({ weekdays, holidays }) => compileCalendar({ id: 'c', workingWeekdays: weekdays as IsoWeekday[], holidays: holidays.map((h) => d('2026-11-01') + h) }));
    const dayArb = fc.option(fc.integer({ min: 0, max: 180 }).map((n) => d('2026-11-15') + n), { nil: null });
    const itemArb = fc.record({ startDate: dayArb, dueDate: dayArb });

    it('equals spanOf over every item (any calendar, any mix of dates)', () => {
        fc.assert(
            fc.property(calendarArb, fc.array(itemArb, { maxLength: 30 }), (c, items) => {
                const naive = spanOf(items.map((i) => plannedSpanOf(i, c)));
                expect(spanFromBounds(boundsOf(items), c)).toEqual(naive);
            }),
            { numRuns: 400 },
        );
    });

    it('merging the bounds of groups equals the bounds of the whole', () => {
        fc.assert(
            fc.property(fc.array(fc.array(itemArb, { maxLength: 8 }), { maxLength: 6 }), (groups) => {
                expect(mergeBounds(groups.map(boundsOf))).toEqual(boundsOf(groups.flat()));
            }),
        );
    });
});
