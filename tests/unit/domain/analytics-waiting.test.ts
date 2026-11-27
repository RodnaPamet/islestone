/**
 * Time waiting (sub-phase 3.6b; `src/app-layer/domain/analytics/waiting.ts`;
 * owner decisions 76, 313 and 317; ADR 0014 §6; docs/porting/maps/3.6.md,
 * "Time waiting", "H3 and 3.6"):
 *
 *   - a field wait is a run of rows naming one person while live and in
 *     scope; a close, a deletion, leaving the scope or another person ends
 *     it; a reopen restores nothing; a restore that still names the person
 *     starts a new one;
 *   - a review wait runs from the step's opening (or the reviewer's being
 *     added) to their response, withdrawal or the step's end, only while the
 *     item is live and in scope;
 *   - elapsed working time on the item's own calendar, a weekend inside a
 *     wait removed even when a row falls in it;
 *   - the window's overlap, ended waits' median and 85th percentile, what
 *     waits at the moment of reading, removed members as one party, and the
 *     share of open item time spent waiting (each instant once);
 *   - properties: waits never overlap per item and person, the relevant
 *     segments (what the SQL read returns) give the same figures as every
 *     segment, the window's time never exceeds the whole, the share stays in
 *     [0, 1].
 */
import fc from 'fast-check';
import type { WorkflowStateCategory } from '@prisma/client';

import { WorkingTimeMeter, type DurationCalendar } from '@/app-layer/domain/analytics/elapsed';
import { byItem } from '@/app-layer/domain/analytics/record';
import {
    fieldWaits,
    relevantSegments,
    reviewWaits,
    segmentsOf,
    waitingFigures,
    type ReviewSpan,
    type Wait,
    type WaitFact,
    type WaitSegment,
} from '@/app-layer/domain/analytics/waiting';
import { compileCalendar } from '@/app-layer/domain/schedule/calendar';

const monFri: DurationCalendar = { timeZone: 'UTC', compiled: compileCalendar({ id: 'c', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }) };
const everyDay: DurationCalendar = { timeZone: 'UTC', compiled: compileCalendar({ id: 'e', workingWeekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] }) };
const meters = (cal: DurationCalendar) => {
    const m = new WorkingTimeMeter(cal);
    return () => m;
};

let seq = 0;
function f(workItemId: string, at: string, stateCategory: WorkflowStateCategory, waitingOnUserId: string | null, extra: Partial<WaitFact> = {}): WaitFact {
    seq += 1;
    return { workItemId, projectId: 'p1', teamId: 't1', cycleId: null, stateCategory, deleted: false, at: new Date(at), seq, waitingOnUserId, ...extra };
}
const ms = (iso: string) => new Date(iso).getTime();
const visible = (r: WaitFact) => r.projectId !== 'hidden';
const days = (w: Wait) => w.pieces.map((p) => [new Date(p.start).toISOString(), new Date(p.end).toISOString()]);

function segs(facts: WaitFact[], R: number, inScope = visible): WaitSegment[] {
    return [...byItem(facts).values()].flatMap((rows) => segmentsOf(rows, inScope, R));
}

describe('field waits', () => {
    // 2031-03-03 is a Monday.
    const R = ms('2031-03-20T12:00:00Z');

    it('is a run of rows naming one person; a weekend inside it is removed even with a row in it', () => {
        const facts = [
            f('i1', '2031-03-03T09:00:00Z', 'UNSTARTED', null),
            f('i1', '2031-03-07T16:00:00Z', 'UNSTARTED', 'ana'), // Friday 16:00
            f('i1', '2031-03-08T11:00:00Z', 'STARTED', 'ana'), // a state change on Saturday
            f('i1', '2031-03-10T10:00:00Z', 'STARTED', null), // Monday 10:00
        ];
        const waits = fieldWaits(segs(facts, R));
        expect(waits).toHaveLength(1);
        expect(waits[0]).toMatchObject({ userId: 'ana', review: false, running: false });
        expect(days(waits[0]!)).toEqual([['2031-03-07T16:00:00.000Z', '2031-03-10T10:00:00.000Z']]);
        const fig = waitingFigures(waits, segs(facts, R), { start: ms('2031-03-01T00:00:00Z'), asOf: R }, meters(monFri), (u) => u);
        // Friday 16:00 to Monday 10:00, the weekend removed: 0.75 days.
        expect(fig.parties.get('ana')).toMatchObject({ waited: 0.8, ended: { count: 1, p50: 0.8, p85: 0.8 }, items: 1, waitingNow: 0 });
    });

    it('ends at another person, at no one, at a close, at a deletion, and on leaving the scope; a reopen restores nothing', () => {
        const facts = [
            f('i2', '2031-03-03T09:00:00Z', 'UNSTARTED', 'ana'),
            f('i2', '2031-03-04T09:00:00Z', 'UNSTARTED', 'ben'), // another person
            f('i2', '2031-03-05T09:00:00Z', 'DONE', null), // a close clears it
            f('i2', '2031-03-06T09:00:00Z', 'STARTED', null), // a reopen restores nothing
            f('i3', '2031-03-03T09:00:00Z', 'UNSTARTED', 'ana'),
            f('i3', '2031-03-04T09:00:00Z', 'UNSTARTED', 'ana', { deleted: true }), // deleted, still naming her
            f('i3', '2031-03-05T09:00:00Z', 'UNSTARTED', 'ana'), // restored: a new wait
            f('i3', '2031-03-06T09:00:00Z', 'UNSTARTED', 'ana', { projectId: 'hidden' }), // moved out of sight
        ];
        const waits = fieldWaits(segs(facts, R)).map((w) => [w.workItemId, w.userId, ...days(w).flat()]);
        expect(waits).toEqual([
            ['i2', 'ana', '2031-03-03T09:00:00.000Z', '2031-03-04T09:00:00.000Z'],
            ['i2', 'ben', '2031-03-04T09:00:00.000Z', '2031-03-05T09:00:00.000Z'],
            ['i3', 'ana', '2031-03-03T09:00:00.000Z', '2031-03-04T09:00:00.000Z'],
            ['i3', 'ana', '2031-03-05T09:00:00.000Z', '2031-03-06T09:00:00.000Z'],
        ]);
    });

    it('runs at the moment of reading, with its age; overlaps the window only in part', () => {
        const facts = [f('i4', '2031-03-03T00:00:00Z', 'UNSTARTED', null), f('i4', '2031-03-11T00:00:00Z', 'STARTED', 'ana')];
        const asOf = ms('2031-03-18T00:00:00Z');
        const waits = fieldWaits(segs(facts, asOf));
        expect(waits[0]!.running).toBe(true);
        const fig = waitingFigures(waits, segs(facts, asOf), { start: ms('2031-03-14T00:00:00Z'), asOf }, meters(everyDay), (u) => u);
        expect(fig.parties.get('ana')).toMatchObject({ waited: 4, waitingNow: 1, ended: { count: 0, p50: null, p85: null }, now: [{ workItemId: 'i4', review: false, age: 7 }] });
        expect(fig.totals).toMatchObject({ waitingNow: 1, items: 1 });
    });

    it('a wait of no length that ended is no wait', () => {
        const facts = [f('i5', '2031-03-03T09:00:00Z', 'UNSTARTED', 'ana'), f('i5', '2031-03-03T09:00:00Z', 'UNSTARTED', null)];
        expect(fieldWaits(segs(facts, R))).toEqual([]);
    });
});

describe('review waits (decision 317)', () => {
    const R = ms('2031-03-20T00:00:00Z');
    const item = [f('r1', '2031-03-01T00:00:00Z', 'STARTED', null), f('r1', '2031-03-12T00:00:00Z', 'STARTED', null, { deleted: true })];

    it('runs from the opening to the response, the withdrawal or the step end, only while the item is live', () => {
        const spans: ReviewSpan[] = [
            { workItemId: 'r1', userId: 'ana', start: ms('2031-03-02T00:00:00Z'), end: ms('2031-03-04T00:00:00Z') },
            { workItemId: 'r1', userId: 'ben', start: ms('2031-03-02T00:00:00Z'), end: null }, // still asked: the deletion ends it
        ];
        const waits = reviewWaits(spans, segs(item, R), R);
        expect(waits.map((w) => [w.userId, w.review, w.running, ...days(w).flat()])).toEqual([
            ['ana', true, false, '2031-03-02T00:00:00.000Z', '2031-03-04T00:00:00.000Z'],
            ['ben', true, false, '2031-03-02T00:00:00.000Z', '2031-03-12T00:00:00.000Z'],
        ]);
    });

    it('is still running while the item is live at the moment of reading, and shown beside field waits', () => {
        const live = [f('r2', '2031-03-01T00:00:00Z', 'STARTED', 'ana'), f('r2', '2031-03-05T00:00:00Z', 'STARTED', null)];
        const spans: ReviewSpan[] = [{ workItemId: 'r2', userId: 'ana', start: ms('2031-03-05T00:00:00Z'), end: null }];
        const all = segs(live, R);
        const waits = [...fieldWaits(all), ...reviewWaits(spans, all, R)];
        const fig = waitingFigures(waits, all, { start: ms('2031-03-01T00:00:00Z'), asOf: R }, meters(everyDay), (u) => u);
        // Four days in waiting on, fifteen as a reviewer, still waiting.
        expect(fig.parties.get('ana')).toMatchObject({ waited: 19, asReviewer: 15, items: 1, waitingNow: 1, ended: { count: 1, p50: 4, p85: 4 } });
        expect(fig.totals.share).toBe(1);
    });
});

describe('figures', () => {
    it('counts each instant of an item once in the share, groups removed members, and summarises ended waits', () => {
        const R = ms('2031-03-11T00:00:00Z');
        const facts = [
            f('a', '2031-03-01T00:00:00Z', 'UNSTARTED', 'gone1'),
            f('a', '2031-03-03T00:00:00Z', 'UNSTARTED', null),
            f('b', '2031-03-01T00:00:00Z', 'UNSTARTED', 'gone2'),
            f('b', '2031-03-05T00:00:00Z', 'DONE', null),
        ];
        const all = segs(facts, R);
        // Two reviewers on item a at once: the item waited once.
        const spans: ReviewSpan[] = [
            { workItemId: 'a', userId: 'ana', start: ms('2031-03-03T00:00:00Z'), end: ms('2031-03-04T00:00:00Z') },
            { workItemId: 'a', userId: 'ben', start: ms('2031-03-03T00:00:00Z'), end: ms('2031-03-04T00:00:00Z') },
        ];
        const waits = [...fieldWaits(all), ...reviewWaits(spans, all, R)];
        const fig = waitingFigures(waits, all, { start: ms('2031-03-01T00:00:00Z'), asOf: R }, meters(everyDay), (u) => (u.startsWith('gone') ? 'former' : u));
        expect(fig.parties.get('former')).toMatchObject({ waited: 6, items: 2, ended: { count: 2, p50: 2, p85: 4 } });
        // Open time: a 10 days, b 4 days; waiting: a 3 days (2 field, 1 review once), b 4.
        expect(fig.totals).toMatchObject({ waited: 8, asReviewer: 2, itemTimeWaiting: 7, openItemTime: 14, share: 0.5, items: 2, waitingNow: 0 });
        expect(fig.totals.ended).toEqual({ count: 4, p50: 1, p85: 4 });
    });

    it('answers no share for no open item time', () => {
        expect(waitingFigures([], [], { start: 0, asOf: 10 }, meters(everyDay), (u) => u).totals.share).toBeNull();
    });
});

describe('properties on random histories', () => {
    const USERS = ['ana', 'ben', 'cy'] as const;
    const ROW = fc.record({
        item: fc.integer({ min: 0, max: 4 }),
        hour: fc.integer({ min: 0, max: 30 * 24 }),
        category: fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'STARTED', 'DONE', 'CANCELLED'),
        waiting: fc.constantFrom<string | null>(null, null, ...USERS),
        deleted: fc.integer({ min: 0, max: 6 }).map((n) => n === 0),
        hidden: fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
        team: fc.constantFrom('t1', 't1', 't2'),
    });
    const SPAN = fc.record({ item: fc.integer({ min: 0, max: 4 }), user: fc.constantFrom(...USERS), start: fc.integer({ min: 0, max: 30 * 24 }), length: fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }) });
    const BASE = ms('2031-03-03T00:00:00Z');

    it('never overlaps per item and person, gives the same figures from the relevant segments, and keeps the share in [0, 1]', () => {
        fc.assert(
            fc.property(fc.array(ROW, { minLength: 1, maxLength: 40 }), fc.array(SPAN, { maxLength: 6 }), fc.integer({ min: 0, max: 30 * 24 }), fc.integer({ min: 1, max: 30 * 24 }), (raw, rawSpans, startH, lenH) => {
                seq = 0;
                const facts = raw.map((r) =>
                    // A closed item never names anyone (2.4b-a's CHECK).
                    f(`i${r.item}`, new Date(BASE + r.hour * 3_600_000).toISOString(), r.category, r.category === 'DONE' || r.category === 'CANCELLED' ? null : r.waiting, {
                        deleted: r.deleted,
                        projectId: r.hidden ? 'hidden' : 'p1',
                        teamId: r.team,
                    }),
                );
                const start = BASE + startH * 3_600_000;
                const R = start + lenH * 3_600_000;
                const spans: ReviewSpan[] = rawSpans.map((s) => ({
                    workItemId: `i${s.item}`,
                    userId: s.user,
                    start: BASE + s.start * 3_600_000,
                    end: s.length === null ? null : BASE + (s.start + s.length) * 3_600_000,
                }));
                const usable = spans.filter((s) => s.start <= R && (s.end === null || s.end >= start));
                const all = segs(facts, R);
                const relevant = relevantSegments(all, start, new Set(usable.map((s) => s.workItemId)));
                const cal = (t: string) => (t === 't1' ? monFri : everyDay);
                const ms1 = new Map<string, WorkingTimeMeter>();
                const meterFor = (t: string) => ms1.get(t) ?? (ms1.set(t, new WorkingTimeMeter(cal(t))), ms1.get(t)!);

                const fromAll = [...fieldWaits(all), ...reviewWaits(usable, all, R)];
                const fromRelevant = [...fieldWaits(relevant), ...reviewWaits(usable, relevant, R)];
                const win = { start, asOf: R };
                const a = waitingFigures(fromAll, all, win, meterFor, (u) => u);
                const b = waitingFigures(fromRelevant, relevant, win, meterFor, (u) => u);
                expect(b).toEqual(a);

                // Never overlapping per item, person and kind.
                const groups = new Map<string, Array<[number, number]>>();
                for (const w of fromAll) {
                    const k = `${w.workItemId}/${w.userId}/${w.review}`;
                    const list = groups.get(k) ?? [];
                    list.push([w.pieces[0]!.start, w.pieces[w.pieces.length - 1]!.end]);
                    groups.set(k, list);
                }
                for (const list of groups.values()) {
                    list.sort((x, y) => x[0] - y[0]);
                    for (let i = 1; i < list.length; i++) expect(list[i]![0]).toBeGreaterThanOrEqual(list[i - 1]![1]);
                }
                if (a.totals.share !== null) {
                    expect(a.totals.share).toBeGreaterThanOrEqual(0);
                    expect(a.totals.share).toBeLessThanOrEqual(1);
                }
                for (const p of a.parties.values()) {
                    expect(p.asReviewer).toBeLessThanOrEqual(p.waited + 0.05);
                    expect(p.waitingNow).toBeLessThanOrEqual(p.items);
                    for (const n of p.now) expect(n.age).toBeGreaterThanOrEqual(0);
                }
            }),
            { numRuns: 300 },
        );
    });
});
