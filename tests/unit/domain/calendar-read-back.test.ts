/**
 * The calendar read-back's pure rules (roadmap 3.3c; ADR 0011 §1 and §4;
 * owner decisions 225, 230, 231 and 232):
 *
 *   - the day an event means (decision 231): an all-day event's last day (its
 *     end exclusive), a timed or multi-day event's last day in its own zone,
 *     an end at exactly midnight on the day before, Windows zone names,
 *     date-only edges (late evening in UTC−10 and early morning in UTC+14,
 *     both a day off in UTC; a daylight-saving day), a zone nobody knows
 *     falling back to the offset the time was written in, garbage refused;
 *   - the decision: Islestone's own write (an equal version) is never a
 *     change; a deleted event removes its row (or forgets one being deleted);
 *     a changed event on the pushed day changed something else and is not
 *     read; a moved day is reported; a row deleted in the calendar or on its
 *     way out takes no change; a property over all-day spans.
 */
import fc from 'fast-check';

import { decideReadBack, eventLastDay, isDay, previousDay, resolveTimeZone, type ReadBackRow, type RemoteEvent } from '@/app-layer/domain/calendar-read-back';
import { googleEventTime, graphEventTime } from '@/app-layer/integrations/providers/calendar/reader';

describe('the day an event means (decision 231)', () => {
    it("an all-day event's last day is the day before its exclusive end, for one day and several", () => {
        expect(eventLastDay({ allDay: true, endDate: '2026-12-11' })).toBe('2026-12-10');
        expect(eventLastDay({ allDay: true, endDate: '2027-01-01' })).toBe('2026-12-31');
        expect(eventLastDay({ allDay: true, endDate: '2028-03-01' })).toBe('2028-02-29');
    });

    it('a timed event late in the evening in UTC−10 is that evening, though UTC is already the next day', () => {
        // 22:30 in Honolulu on 1 December is 08:30 UTC on 2 December.
        expect(eventLastDay({ allDay: false, end: '2026-12-01T22:30:00-10:00', timeZone: 'Pacific/Honolulu' })).toBe('2026-12-01');
        expect(eventLastDay({ allDay: false, end: '2026-12-02T08:30:00Z', timeZone: 'Pacific/Honolulu' })).toBe('2026-12-01');
        expect(eventLastDay({ allDay: false, end: '2026-12-02T08:30:00Z', timeZone: 'Hawaiian Standard Time' })).toBe('2026-12-01');
    });

    it('a timed event early in the morning in UTC+14 is that morning, though UTC is still the day before', () => {
        // 01:00 on Kiritimati on 2 December is 11:00 UTC on 1 December.
        expect(eventLastDay({ allDay: false, end: '2026-12-02T01:00:00+14:00', timeZone: 'Pacific/Kiritimati' })).toBe('2026-12-02');
        expect(eventLastDay({ allDay: false, end: '2026-12-01T11:00:00Z', timeZone: 'Line Islands Standard Time' })).toBe('2026-12-02');
    });

    it('an end at exactly midnight belongs to the day before; a multi-day timed event is its last day', () => {
        expect(eventLastDay({ allDay: false, end: '2026-12-02T00:00:00+02:00', timeZone: 'Europe/Sofia' })).toBe('2026-12-01');
        expect(eventLastDay({ allDay: false, end: '2026-12-05T09:15:00+02:00', timeZone: 'Europe/Sofia' })).toBe('2026-12-05');
    });

    it('a daylight-saving day: the zone, not a fixed offset, decides', () => {
        // Sofia enters summer time at 03:00 on 29 March 2026 (UTC+2 → UTC+3):
        // 21:30 UTC that evening is 00:30 on the 30th there, where a fixed +2 would say 23:30 on the 29th.
        expect(eventLastDay({ allDay: false, end: '2026-03-29T21:30:00Z', timeZone: 'Europe/Sofia' })).toBe('2026-03-30');
        // It leaves summer time on 25 October (UTC+3 → UTC+2): 21:30 UTC is 23:30 on the 25th,
        // where a fixed +3 would say 00:30 on the 26th.
        expect(eventLastDay({ allDay: false, end: '2026-10-25T21:30:00Z', timeZone: 'Europe/Sofia' })).toBe('2026-10-25');
        // Midnight on the changing night still belongs to the day before.
        expect(eventLastDay({ allDay: false, end: '2026-10-25T22:00:00Z', timeZone: 'Europe/Sofia' })).toBe('2026-10-25');
    });

    it('a zone nobody knows falls back to the offset the provider wrote; garbage is refused', () => {
        expect(resolveTimeZone('tzone://Microsoft/Custom')).toBeNull();
        expect(eventLastDay({ allDay: false, end: '2026-12-01T22:30:00-10:00', timeZone: 'tzone://Microsoft/Custom' })).toBe('2026-12-01');
        expect(eventLastDay({ allDay: false, end: '2026-12-02T08:30:00Z', timeZone: null })).toBe('2026-12-02');
        expect(eventLastDay({ allDay: false, end: 'tomorrow', timeZone: null })).toBeNull();
        expect(eventLastDay({ allDay: true, endDate: '2026-02-30' })).toBeNull();
        expect(isDay('2026-02-28')).toBe(true);
        expect(isDay('2026-13-01')).toBe(false);
    });

    it("reads Google's and Graph's shapes: all-day dates, timed date-times and their zones", () => {
        expect(googleEventTime({ date: '2026-12-11' })).toEqual({ allDay: true, endDate: '2026-12-11' });
        expect(googleEventTime({ dateTime: '2026-12-01T22:30:00-10:00', timeZone: 'Pacific/Honolulu' })).toEqual({ allDay: false, end: '2026-12-01T22:30:00-10:00', timeZone: 'Pacific/Honolulu' });
        expect(graphEventTime({ isAllDay: true, end: { dateTime: '2026-12-11T00:00:00.0000000', timeZone: 'UTC' } })).toEqual({ allDay: true, endDate: '2026-12-11' });
        expect(graphEventTime({ isAllDay: false, end: { dateTime: '2026-12-02T08:30:00.0000000', timeZone: 'UTC' }, originalEndTimeZone: 'Hawaiian Standard Time' })).toEqual({
            allDay: false,
            end: '2026-12-02T08:30:00.000Z',
            timeZone: 'Hawaiian Standard Time',
        });
        // Not the UTC Islestone asked for: unread rather than guessed.
        expect(graphEventTime({ isAllDay: false, end: { dateTime: '2026-12-02T08:30:00', timeZone: 'Pacific Standard Time' } })).toBeNull();
    });

    it('property: an all-day event of any length ending on any day means its last day', () => {
        fc.assert(
            fc.property(fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2099-12-31T00:00:00Z'), noInvalidDate: true }), fc.integer({ min: 1, max: 60 }), (start, length) => {
                const first = start.toISOString().slice(0, 10);
                const end = new Date(`${first}T00:00:00Z`);
                end.setUTCDate(end.getUTCDate() + length);
                const endDate = end.toISOString().slice(0, 10);
                const last = eventLastDay({ allDay: true, endDate });
                return last === previousDay(endDate) && last! >= first;
            }),
        );
    });
});

describe('what the read-back does with an event (decisions 225, 230, 232)', () => {
    const row = (over: Partial<ReadBackRow> = {}): ReadBackRow => ({ remoteEventId: 'ev1', remoteVersion: '"3"', pushedDueDate: '2026-12-10', state: 'PUSHED', ...over });
    const moved = (endDate: string, version = '"4"', over: Partial<RemoteEvent> = {}): RemoteEvent => ({ remoteEventId: 'ev1', remoteVersion: version, deleted: false, time: { allDay: true, endDate }, ...over });

    it("Islestone's own write (the stored version) is never a change, whatever its day", () => {
        expect(decideReadBack(row(), moved('2026-12-20', '"3"'))).toEqual({ kind: 'none' });
    });

    it('a moved day is reported; the same day with a new version changed something else and is not read', () => {
        expect(decideReadBack(row(), moved('2026-12-13'))).toEqual({ kind: 'moved', movedTo: '2026-12-12' });
        expect(decideReadBack(row(), moved('2026-12-11'))).toEqual({ kind: 'none' });
        expect(decideReadBack(row({ state: 'FAILED' }), moved('2026-12-13'))).toEqual({ kind: 'moved', movedTo: '2026-12-12' });
    });

    it('a deleted event removes its row; a row being deleted is forgotten; one already removed stays', () => {
        const gone: RemoteEvent = { remoteEventId: 'ev1', remoteVersion: null, deleted: true, time: null };
        expect(decideReadBack(row(), gone)).toEqual({ kind: 'removed' });
        expect(decideReadBack(row({ state: 'PENDING_DELETE' }), gone)).toEqual({ kind: 'forget' });
        expect(decideReadBack(row({ state: 'REMOVED_IN_CALENDAR' }), gone)).toEqual({ kind: 'none' });
    });

    it('a row removed in the calendar or on its way out takes no move; an unconfirmed row or another id is not matched', () => {
        expect(decideReadBack(row({ state: 'REMOVED_IN_CALENDAR' }), moved('2026-12-13'))).toEqual({ kind: 'none' });
        expect(decideReadBack(row({ state: 'PENDING_DELETE' }), moved('2026-12-13'))).toEqual({ kind: 'none' });
        expect(decideReadBack(row({ remoteEventId: '' }), moved('2026-12-13'))).toEqual({ kind: 'none' });
        expect(decideReadBack(row(), { ...moved('2026-12-13'), remoteEventId: 'someone-else' })).toEqual({ kind: 'none' });
        expect(decideReadBack(row(), { ...moved('2026-12-13'), time: null })).toEqual({ kind: 'none' });
    });
});
