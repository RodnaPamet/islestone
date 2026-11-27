/**
 * Cumulative flow and the burn-up for any scope (sub-phase 3.6a; ADR 0014;
 * docs/porting/maps/3.6.md, "Cumulative flow" and "The burn-up, for any
 * scope").
 *
 * One event sweep: each item's rows are walked once in the record's order,
 * and every row that changes what the item counts as (its bucket, or its
 * weight under a measure) becomes a −1 and a +1 on the day it happens. A
 * running sum from the window's first day then gives each day's end. Rows
 * before the window fold into its first day; rows after the moment of reading
 * are never read. O(rows log rows + days), where 2.5a's per-day scan was
 * O(days × rows).
 *
 * Buckets, at the end of each day (the scope's zone; "now" for today, as the
 * burn-up always did):
 *   OUT          not in scope (the recorded project, cycle, milestone … do
 *                not match, or the project is not visible), deleted, or
 *                Cancelled;
 *   BACKLOG, UNSTARTED, STARTED   in scope, in that category;
 *   DONE         in scope and Done, entered on or after `doneSince`;
 *   DONE_BEFORE  in scope and Done, entered before `doneSince` (cumulative
 *                flow shows only work done in its window; the burn-up counts
 *                both).
 *
 * The instant of midnight belongs to the day it begins: a day's end is every
 * row strictly before the next day's start. (2.5a's scan also counted a row
 * at exactly that instant in the day it ends; nothing else changed.)
 *
 * Pure. Written fresh for Islestone.
 */
import type { EpochDay } from '../schedule/calendar';
import type { BurnUpMeasure } from '../burn-up';
import { compareFacts, isCompletionRow, type RecordFact } from './record';
import { epochDayOf } from './zone';

export const FLOW_BUCKETS = ['BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'DONE_BEFORE'] as const;
export type FlowBucket = (typeof FLOW_BUCKETS)[number];

export interface FlowInput<T extends RecordFact = RecordFact> {
    /** The window's first and last days, inclusive; the last no later than `today`. */
    fromDay: EpochDay;
    toDay: EpochDay;
    /** The moment of reading: rows after it are never read, and today's point is drawn at it. */
    now: Date;
    /** The zone days are cut in. */
    timeZone: string;
    facts: readonly T[];
    /** Whether a row's recorded fields put the item in scope (deletion and Cancelled are handled here). */
    inScope(row: T): boolean;
    /** Done entered before this instant counts as `DONE_BEFORE`; null: every Done is `DONE`. */
    doneSince: Date | null;
    /** Items (the default), points, or hours as minutes. */
    measure?: BurnUpMeasure;
}

export interface FlowDay {
    day: EpochDay;
    /** Items per bucket (items with no estimate in the measure's unit are in `unestimated`, not here). */
    counts: Record<FlowBucket, number>;
    /** The measure summed per bucket (equal to `counts` for items). */
    weights: Record<FlowBucket, number>;
    /** In-scope items with no estimate in the measure's unit; 0 for items. */
    unestimated: number;
}

type Contribution = { bucket: FlowBucket; weight: number | null } | null;

function weightOf(row: RecordFact, measure: BurnUpMeasure): number | null {
    if (measure === 'items') return 1;
    return (measure === 'points' ? row.estimatePoints : row.estimateMinutes) ?? null;
}

function zeroes(): Record<FlowBucket, number> {
    return { BACKLOG: 0, UNSTARTED: 0, STARTED: 0, DONE: 0, DONE_BEFORE: 0 };
}

function sameContribution(a: Contribution, b: Contribution): boolean {
    if (a === null || b === null) return a === b;
    return a.bucket === b.bucket && a.weight === b.weight;
}

/** Each day's buckets, from `fromDay` to `toDay`. */
export function flowSweep<T extends RecordFact>(input: FlowInput<T>): FlowDay[] {
    const days = input.toDay - input.fromDay + 1;
    if (days <= 0) return [];
    const measure = input.measure ?? 'items';
    const nowMs = input.now.getTime();
    const doneSince = input.doneSince?.getTime() ?? null;
    // Index 0 is "before the window"; 1 … days are the window's days.
    const dCount = Array.from({ length: days + 1 }, zeroes);
    const dWeight = Array.from({ length: days + 1 }, zeroes);
    const dUnest = new Array<number>(days + 1).fill(0);

    const apply = (index: number, c: Contribution, sign: 1 | -1) => {
        if (c === null) return;
        if (c.weight === null) {
            dUnest[index]! += sign;
            return;
        }
        dCount[index]![c.bucket] += sign;
        dWeight[index]![c.bucket] += sign * c.weight;
    };

    const items = new Map<string, T[]>();
    for (const f of input.facts) {
        if (f.at.getTime() > nowMs) continue;
        const list = items.get(f.workItemId);
        if (list) list.push(f);
        else items.set(f.workItemId, [f]);
    }

    for (const rows of items.values()) {
        rows.sort(compareFacts);
        let current: Contribution = null;
        let previous: T | null = null;
        let doneEntry = -Infinity;
        for (const r of rows) {
            if (isCompletionRow(r, previous)) doneEntry = r.at.getTime();
            previous = r;
            const day = epochDayOf(r.at, input.timeZone);
            if (day > input.toDay) break;
            const index = Math.max(0, day - input.fromDay + 1);
            let next: Contribution = null;
            if (input.inScope(r) && !r.deleted && r.stateCategory !== 'CANCELLED') {
                const bucket: FlowBucket = r.stateCategory === 'DONE' ? (doneSince !== null && doneEntry < doneSince ? 'DONE_BEFORE' : 'DONE') : r.stateCategory;
                next = { bucket, weight: weightOf(r, measure) };
            }
            if (sameContribution(current, next)) continue;
            apply(index, current, -1);
            apply(index, next, 1);
            current = next;
        }
    }

    const out: FlowDay[] = [];
    const counts = zeroes();
    const weights = zeroes();
    let unestimated = 0;
    for (let i = 0; i <= days; i++) {
        for (const b of FLOW_BUCKETS) {
            counts[b] += dCount[i]![b];
            weights[b] += dWeight[i]![b];
        }
        unestimated += dUnest[i]!;
        if (i > 0) out.push({ day: input.fromDay + i - 1, counts: { ...counts }, weights: { ...weights }, unestimated });
    }
    return out;
}

/** A flow day as the burn-up counts it: scope (every in-scope bucket), started (Started or Done), completed (Done). */
export function burnUpOf(day: FlowDay): { scope: number; started: number; completed: number } {
    const w = day.weights;
    const completed = w.DONE + w.DONE_BEFORE;
    return { scope: w.BACKLOG + w.UNSTARTED + w.STARTED + completed, started: w.STARTED + completed, completed };
}

/** A flow day as cumulative flow draws it: the open categories now, and Done since the window's start. */
export function cumulativeFlowOf(day: FlowDay): { backlog: number; unstarted: number; started: number; done: number } {
    const c = day.counts;
    return { backlog: c.BACKLOG, unstarted: c.UNSTARTED, started: c.STARTED, done: c.DONE };
}
