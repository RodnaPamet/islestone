/**
 * Repeats: the one home of Islestone's date stepping for repeating items
 * (sub-phase 2.5d; docs/porting/maps/2.5.md; owner decisions 67 and 68).
 *
 * A rule repeats every N days, weeks, months or years (N 1 to 99), weekly on
 * chosen weekdays, monthly on the same day of the month clamped to the end
 * of a short month (computed from the first date each time, so a series on
 * the 31st lands on 28 or 29 February and then on 31 March), with an
 * optional end date or number of times. No time zone: due dates are
 * date-only (UTC date parts), and so is every value here.
 *
 * Occurrences are numbered from 1. Occurrence 1 is `firstOn`, the due date of
 * the item where the repeat was set; the rule's later dates are strictly
 * after it. A weekly rule's weeks start on Monday and repeat every
 * `interval` weeks from `firstOn`'s week.
 *
 * Pattern only, no code copied: inflect-compliance
 * `src/app-layer/utils/cadence.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (BUSL-1.1; months by calendar with the month-end clamp), and Kaneo
 * `apps/api/src/task/recurrence/next-occurrence-date.ts` at
 * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3 (MIT; the rule's shape). Written
 * fresh on date-only values. Pure and property-tested.
 */
import type { RecurrenceFrequency } from '@prisma/client';

import { addDays, daysBetween } from './cycle';

export const RECURRENCE_LIMITS = {
    interval: { min: 1, max: 99 },
    leadDays: { min: 0, max: 30, default: 3 },
    maxOccurrences: { min: 2, max: 1000 },
} as const;

export interface RecurrenceRule {
    frequency: RecurrenceFrequency;
    interval: number;
    /** Weekly only: 0 (Sunday) to 6 (Saturday), as `Date.getUTCDay()`. Empty means `firstOn`'s weekday. */
    weekdays: readonly number[];
    firstOn: Date;
    endsOn: Date | null;
    maxOccurrences: number | null;
}

export interface Occurrence {
    on: Date;
    /** 1 for `firstOn`, then 2, 3, … */
    number: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Monday-based weekday: Monday 0 … Sunday 6. */
function mondayIndex(d: Date): number {
    return (d.getUTCDay() + 6) % 7;
}

function weekStart(d: Date): Date {
    return addDays(d, -mondayIndex(d));
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `first` moved by `months` calendar months, its day clamped to the month's last day. */
export function addMonthsClamped(first: Date, months: number): Date {
    const total = first.getUTCFullYear() * 12 + first.getUTCMonth() + months;
    const year = Math.floor(total / 12);
    const month = total - year * 12;
    return new Date(Date.UTC(year, month, Math.min(first.getUTCDate(), daysInMonth(year, month))));
}

function monthStep(rule: RecurrenceRule): number {
    return rule.frequency === 'YEARLY' ? rule.interval * 12 : rule.interval;
}

/** The weekly rule's weekdays, Monday-based and sorted; `firstOn`'s when none are chosen. */
function weeklyDays(rule: RecurrenceRule): number[] {
    const days = rule.weekdays.length > 0 ? rule.weekdays.map((d) => (d + 6) % 7) : [mondayIndex(rule.firstOn)];
    return [...new Set(days)].sort((a, b) => a - b);
}

/** The date of occurrence `n` (n ≥ 1), ignoring the rule's end. */
export function occurrenceOn(rule: RecurrenceRule, n: number): Date {
    if (n <= 1) return rule.firstOn;
    switch (rule.frequency) {
        case 'DAILY':
            return addDays(rule.firstOn, (n - 1) * rule.interval);
        case 'MONTHLY':
        case 'YEARLY':
            return addMonthsClamped(rule.firstOn, (n - 1) * monthStep(rule));
        case 'WEEKLY': {
            const days = weeklyDays(rule);
            const m0 = mondayIndex(rule.firstOn);
            const firstWeek = days.filter((d) => d > m0);
            const ws0 = weekStart(rule.firstOn);
            const r = n - 2;
            if (r < firstWeek.length) return addDays(ws0, firstWeek[r]!);
            const rest = r - firstWeek.length;
            const cycle = Math.floor(rest / days.length) + 1;
            return addDays(ws0, cycle * rule.interval * 7 + days[rest % days.length]!);
        }
    }
}

/** The first occurrence strictly after `d` (`firstOn` when `d` is earlier), ignoring the rule's end. */
export function firstOccurrenceAfter(rule: RecurrenceRule, d: Date): Occurrence {
    if (d.getTime() < rule.firstOn.getTime()) return { on: rule.firstOn, number: 1 };
    switch (rule.frequency) {
        case 'DAILY': {
            const k = Math.floor(daysBetween(rule.firstOn, d) / rule.interval) + 1;
            return { on: addDays(rule.firstOn, k * rule.interval), number: k + 1 };
        }
        case 'MONTHLY':
        case 'YEARLY': {
            const step = monthStep(rule);
            const months = (d.getUTCFullYear() - rule.firstOn.getUTCFullYear()) * 12 + (d.getUTCMonth() - rule.firstOn.getUTCMonth());
            let k = Math.max(0, Math.floor(months / step));
            while (addMonthsClamped(rule.firstOn, k * step).getTime() <= d.getTime()) k += 1;
            return { on: addMonthsClamped(rule.firstOn, k * step), number: k + 1 };
        }
        case 'WEEKLY': {
            const days = weeklyDays(rule);
            const m0 = mondayIndex(rule.firstOn);
            const firstWeek = days.filter((x) => x > m0);
            const ws0 = weekStart(rule.firstOn);
            const week = Math.floor(daysBetween(ws0, d) / 7);
            const md = mondayIndex(d);
            if (week === 0) {
                const p = firstWeek.findIndex((x) => x > md);
                if (p >= 0) return { on: addDays(ws0, firstWeek[p]!), number: p + 2 };
            }
            let cycle = Math.max(1, Math.ceil(week / rule.interval));
            let p = 0;
            if (cycle * rule.interval === week) {
                p = days.findIndex((x) => x > md);
                if (p < 0) {
                    cycle += 1;
                    p = 0;
                }
            }
            return { on: addDays(ws0, cycle * rule.interval * 7 + days[p]!), number: 2 + firstWeek.length + (cycle - 1) * days.length + p };
        }
    }
}

/** Is the occurrence inside the rule's end (date and count)? */
export function withinEnd(rule: RecurrenceRule, occ: Occurrence): boolean {
    if (rule.endsOn && occ.on.getTime() > rule.endsOn.getTime()) return false;
    if (rule.maxOccurrences !== null && occ.number > rule.maxOccurrences) return false;
    return true;
}

/**
 * The next occurrence a rule set or resumed on `today` waits for: after
 * `firstOn`, and at least `leadDays` away, so its make day (due date minus
 * lead days) is today or later and nothing is counted as missed. A run makes
 * one occurrence per rule, so a repeat starts there rather than with copies
 * already inside the lead window. `null` when the rule has ended.
 */
export function nextOccurrenceFrom(rule: RecurrenceRule, today: Date, leadDays = 0): Occurrence | null {
    const earliest = addDays(today, leadDays);
    const after = earliest.getTime() > rule.firstOn.getTime() ? addDays(earliest, -1) : rule.firstOn;
    const next = firstOccurrenceAfter(rule, after);
    return withinEnd(rule, next) ? next : null;
}

export interface DuePlan {
    /** The occurrence to make now: the latest one whose make-by day has come. */
    make: Occurrence;
    /** Earlier occurrences that fell due and are not made (the job was not running). */
    skipped: number;
    /** What the rule waits for next, or `null` when it ends after this one. */
    following: Occurrence | null;
}

/**
 * What a run on `today` makes for a rule waiting for `next`: the latest
 * occurrence on or before `today + leadDays` within the rule's end, never an
 * earlier one too (decision 68: only the latest missed copy). `null` when
 * nothing is due yet.
 */
export function planDue(rule: RecurrenceRule, next: Occurrence, today: Date, leadDays: number): DuePlan | null {
    const horizon = addDays(today, leadDays);
    if (next.on.getTime() > horizon.getTime() || !withinEnd(rule, next)) return null;
    let last = firstOccurrenceAfter(rule, horizon).number - 1;
    if (rule.maxOccurrences !== null) last = Math.min(last, rule.maxOccurrences);
    if (rule.endsOn) last = Math.min(last, firstOccurrenceAfter(rule, rule.endsOn).number - 1);
    last = Math.max(last, next.number);
    const make = { on: occurrenceOn(rule, last), number: last };
    const after = { on: occurrenceOn(rule, last + 1), number: last + 1 };
    return { make, skipped: last - next.number, following: withinEnd(rule, after) ? after : null };
}

/** The number of `on` in the rule, or `null` when it is not one of its dates (a stamped date always is). */
export function numberOf(rule: RecurrenceRule, on: Date): number | null {
    const n = firstOccurrenceAfter(rule, new Date(on.getTime() - DAY)).number;
    return occurrenceOn(rule, n).getTime() === on.getTime() ? n : null;
}
