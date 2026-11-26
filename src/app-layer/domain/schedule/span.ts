/**
 * The engine's spans (roadmap 3.1b and 3.2c; ADR 0010; owner decisions 185,
 * 186 and 215). Pure and client-safe, like the rest of the engine.
 *
 *   - **`spanOf`** is the one rule a summary is drawn with: from the earliest
 *     first day to the latest last day of what it holds. The engine's own
 *     summaries (decision 186: a parent spans its sub-items) are computed
 *     with it, and so are the roadmap's bars (decision 215: a project spans
 *     its items, an initiative its projects, a goal its initiatives and its
 *     direct items).
 *   - **`plannedSpanOf`** reads one item's STORED dates the way the engine
 *     reads them (decision 185): both dates, from the start to the due date;
 *     only a due date, one working day ending on it; only a start date, one
 *     working day from it; start after due (`DATES_REVERSED`), one working
 *     day ending on the due date; neither, no span ("No dates"). The
 *     roadmap draws plans, so nothing here moves a date: no "today", no
 *     blocks relation, no actual date of a done item.
 *   - **`spanFromBounds`** is the same answer from the four boundary dates an
 *     aggregate can return per group (the roadmap's read never loads its
 *     items): the earliest start of an item whose start is its first day,
 *     the earliest due date of an item drawn as one day ending on its due
 *     date, the latest due date, and the latest start of an item with no
 *     due date. `previousWorkingDay` and `nextWorkingDay` keep order, so the
 *     answer equals `spanOf` over every item's `plannedSpanOf`
 *     (property-tested in `tests/unit/domain/schedule-span.test.ts`).
 *
 * Written fresh for Islestone.
 */
import { nextWorkingDay, previousWorkingDay, type CompiledCalendar, type EpochDay } from './calendar';

/** A run of days, both ends inclusive (epoch days). */
export interface DaySpan {
    start: EpochDay;
    end: EpochDay;
}

/** An item's stored dates as epoch days. */
export interface PlannedDates {
    startDate: EpochDay | null;
    dueDate: EpochDay | null;
}

/** The span of several spans: the earliest start to the latest end; `null` for none. */
export function spanOf(spans: Iterable<DaySpan | null | undefined>): DaySpan | null {
    let out: DaySpan | null = null;
    for (const s of spans) {
        if (!s) continue;
        if (out === null) out = { start: s.start, end: s.end };
        else {
            if (s.start < out.start) out.start = s.start;
            if (s.end > out.end) out.end = s.end;
        }
    }
    return out;
}

/** One item's planned days on its calendar, as the engine reads its stored dates (decision 185). */
export function plannedSpanOf(dates: PlannedDates, cal: CompiledCalendar): DaySpan | null {
    const { startDate: s, dueDate: d } = dates;
    if (s !== null && d !== null && s <= d) return { start: s, end: d };
    if (d !== null) return { start: previousWorkingDay(cal, d), end: d };
    if (s !== null) return { start: s, end: nextWorkingDay(cal, s) };
    return null;
}

/**
 * The four boundary dates of a group of items (each `null` when no item of
 * the group has that shape), as `boundsOf` and the roadmap's aggregate
 * compute them:
 *
 *   - `minStart`: the earliest start date of an item that has one and is not
 *     reversed (its start is its first day);
 *   - `minDueOnly`: the earliest due date of an item with no start date, or
 *     whose start is after its due date (one working day ending on it);
 *   - `maxDue`: the latest due date of any item;
 *   - `maxStartOnly`: the latest start date of an item with no due date.
 */
export interface SpanBounds {
    minStart: EpochDay | null;
    minDueOnly: EpochDay | null;
    maxDue: EpochDay | null;
    maxStartOnly: EpochDay | null;
}

export const NO_BOUNDS: Readonly<SpanBounds> = Object.freeze({ minStart: null, minDueOnly: null, maxDue: null, maxStartOnly: null });

const minOf = (a: EpochDay | null, b: EpochDay | null): EpochDay | null => (a === null ? b : b === null ? a : Math.min(a, b));
const maxOf = (a: EpochDay | null, b: EpochDay | null): EpochDay | null => (a === null ? b : b === null ? a : Math.max(a, b));

/** The bounds of several groups taken together (each bound its own min or max). */
export function mergeBounds(parts: Iterable<SpanBounds>): SpanBounds {
    let out: SpanBounds = { ...NO_BOUNDS };
    for (const p of parts) {
        out = {
            minStart: minOf(out.minStart, p.minStart),
            minDueOnly: minOf(out.minDueOnly, p.minDueOnly),
            maxDue: maxOf(out.maxDue, p.maxDue),
            maxStartOnly: maxOf(out.maxStartOnly, p.maxStartOnly),
        };
    }
    return out;
}

/** The bounds of a list of items, computed as the roadmap's aggregate computes them in SQL. */
export function boundsOf(items: Iterable<PlannedDates>): SpanBounds {
    const out: SpanBounds = { ...NO_BOUNDS };
    for (const { startDate: s, dueDate: d } of items) {
        const reversed = s !== null && d !== null && s > d;
        if (s !== null && !reversed) out.minStart = minOf(out.minStart, s);
        if (d !== null && (s === null || reversed)) out.minDueOnly = minOf(out.minDueOnly, d);
        if (d !== null) out.maxDue = maxOf(out.maxDue, d);
        if (s !== null && d === null) out.maxStartOnly = maxOf(out.maxStartOnly, s);
    }
    return out;
}

/** The span of a group from its bounds on one calendar: equal to `spanOf` over its items' `plannedSpanOf`. */
export function spanFromBounds(b: SpanBounds, cal: CompiledCalendar): DaySpan | null {
    const start = minOf(b.minStart, b.minDueOnly === null ? null : previousWorkingDay(cal, b.minDueOnly));
    const end = maxOf(b.maxDue, b.maxStartOnly === null ? null : nextWorkingDay(cal, b.maxStartOnly));
    if (start === null || end === null) return null;
    return { start, end };
}
