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
 * Counted, at the end of each day (in the cycle's team's working calendar's
 * zone since 3.6a, owner decision 316; "now" for today):
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
 * Since 3.6a the series is computed by the event sweep of
 * `analytics/flow.ts` (one walk of the rows), the per-day scan it replaced
 * kept as the oracle of its property test; a day's end is every row strictly
 * before the next day begins.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "The transitions and
 * the burn-up"). circle's synthetic curve is refused (docs/porting/oss/circle.md §4.10).
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { burnUpOf, flowSweep } from './analytics/flow';
import { addDays, dayKey, daysBetween } from './cycle';
import { toEpochDay } from './schedule/calendar';

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

export { startOfDayInTz } from './analytics/zone';

/**
 * The burn-up series: one point per day from `startsOn` to the earlier of
 * `endsOn` and `today`. An upcoming cycle has no points.
 */
export function burnUp(input: BurnUpInput): BurnUpPoint[] {
    const lastDay = input.today.getTime() < input.endsOn.getTime() ? input.today : input.endsOn;
    const days = daysBetween(input.startsOn, lastDay);
    if (days < 0) return [];
    const measure = input.measure ?? 'items';
    // 3.6a: one event sweep over the rows (`analytics/flow.ts`), the item's
    // project and team being irrelevant to a cycle's scope.
    const flow = flowSweep({
        fromDay: toEpochDay(input.startsOn),
        toDay: toEpochDay(lastDay),
        now: input.now,
        timeZone: input.tz,
        facts: input.transitions.map((t) => ({ ...t, projectId: '', teamId: '' })),
        inScope: (row) => row.cycleId === input.cycleId,
        doneSince: null,
        measure,
    });
    return flow.map((day) => {
        const { scope, started, completed } = burnUpOf(day);
        const date = dayKey(addDays(input.startsOn, day.day - toEpochDay(input.startsOn)));
        return measure === 'items' ? { date, scope, started, completed } : { date, scope, started, completed, unestimated: day.unestimated };
    });
}
