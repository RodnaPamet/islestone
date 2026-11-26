/**
 * The burn-up (sub-phase 2.5a, owner decisions 65 and 66; ADR 0006
 * "Burn-up"): a cycle's scope, started and completed items, one point per day,
 * computed from `WorkItemTransition` rows. Pure: no database and no clock.
 *
 * Each transition is the item's picture right after a change (the trigger
 * `work_item_transition_record` writes one after every insert and every
 * change of state, cycle, project or deletion), so an item's state at an
 * instant is its latest transition at or before that instant, ties broken by
 * the row's sequence id.
 *
 * Counted, at the end of each day (in the reminder zone; "now" for today):
 *   scope      in the cycle, not deleted, not CANCELLED (owner decision 65);
 *   started    in scope and STARTED or DONE;
 *   completed  in scope and DONE.
 * By default items are counted. From 3.4a (owner decision 259) the same
 * pictures are summed in points or in minutes (`measure`): each in-scope
 * item adds its estimate in that unit as its latest transition records it,
 * so an estimate changed mid-cycle shows as a change of scope on the day it
 * changed; an in-scope item with no estimate in that unit adds nothing and is
 * counted in `unestimated`. The items measure is unchanged.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "The transitions and
 * the burn-up"). circle's synthetic curve is refused (docs/porting/oss/circle.md §4.10).
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { addDays, dayKey, daysBetween } from './cycle';

export interface TransitionFact {
    workItemId: string;
    cycleId: string | null;
    stateCategory: WorkflowStateCategory;
    deleted: boolean;
    at: Date;
    /** The row's sequence id: the order of two changes at one instant. */
    seq: number;
    /** The estimate the row records (3.4a); absent or NULL in rows written before. */
    estimatePoints?: number | null;
    estimateMinutes?: number | null;
}

/** What the burn-up counts (3.4a, decision 259). */
export type BurnUpMeasure = 'items' | 'points' | 'hours';

export interface BurnUpPoint {
    /** `YYYY-MM-DD`. */
    date: string;
    scope: number;
    started: number;
    completed: number;
    /** In-scope items with no estimate in the measure's unit; absent for `items`, whose output is 2.5a's unchanged. */
    unestimated?: number;
}

export interface BurnUpInput {
    cycleId: string;
    startsOn: Date;
    endsOn: Date;
    /** Today's calendar date in `tz`, date-only. */
    today: Date;
    now: Date;
    tz: string;
    transitions: readonly TransitionFact[];
    /** Items (the default), points, or hours as minutes (3.4a). */
    measure?: BurnUpMeasure;
}

/** What one in-scope item adds under `measure`: 1, its estimate, or `null` (no estimate in that unit). */
function weightOf(state: TransitionFact, measure: BurnUpMeasure): number | null {
    if (measure === 'items') return 1;
    const value = measure === 'points' ? state.estimatePoints : state.estimateMinutes;
    return value ?? null;
}

/** The offset of `tz` from UTC at the instant `at`, in milliseconds. */
function zoneOffsetMs(at: Date, tz: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the calendar date `day` (date-only) begins in `tz`. */
export function startOfDayInTz(day: Date, tz: string): Date {
    const guess = day.getTime();
    const first = guess - zoneOffsetMs(new Date(guess), tz);
    // A second pass settles a day whose start falls across an offset change.
    return new Date(guess - zoneOffsetMs(new Date(first), tz));
}

function later(a: TransitionFact, b: TransitionFact): boolean {
    return a.at.getTime() !== b.at.getTime() ? a.at.getTime() > b.at.getTime() : a.seq > b.seq;
}

/**
 * The burn-up series: one point per day from `startsOn` to the earlier of
 * `endsOn` and `today`. An upcoming cycle has no points.
 */
export function burnUp(input: BurnUpInput): BurnUpPoint[] {
    const lastDay = input.today.getTime() < input.endsOn.getTime() ? input.today : input.endsOn;
    const days = daysBetween(input.startsOn, lastDay);
    if (days < 0) return [];

    const byItem = new Map<string, TransitionFact[]>();
    for (const t of input.transitions) {
        const list = byItem.get(t.workItemId);
        if (list) list.push(t);
        else byItem.set(t.workItemId, [t]);
    }

    const points: BurnUpPoint[] = [];
    for (let i = 0; i <= days; i++) {
        const day = addDays(input.startsOn, i);
        const isToday = day.getTime() === input.today.getTime();
        const cutoff = isToday ? input.now.getTime() : startOfDayInTz(addDays(day, 1), input.tz).getTime();
        let scope = 0;
        let started = 0;
        let completed = 0;
        let unestimated = 0;
        const measure = input.measure ?? 'items';
        for (const list of byItem.values()) {
            let state: TransitionFact | null = null;
            for (const t of list) {
                if (t.at.getTime() > cutoff) continue;
                if (!state || later(t, state)) state = t;
            }
            if (!state || state.cycleId !== input.cycleId || state.deleted || state.stateCategory === 'CANCELLED') continue;
            const weight = weightOf(state, measure);
            if (weight === null) {
                unestimated += 1;
                continue;
            }
            scope += weight;
            if (state.stateCategory === 'STARTED' || state.stateCategory === 'DONE') started += weight;
            if (state.stateCategory === 'DONE') completed += weight;
        }
        points.push(measure === 'items' ? { date: dayKey(day), scope, started, completed } : { date: dayKey(day), scope, started, completed, unestimated });
    }
    return points;
}
