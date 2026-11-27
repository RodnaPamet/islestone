/**
 * Cycle time, lead time and age (sub-phase 3.6a, owner decisions 312 and 313;
 * ADR 0014 §3; docs/porting/maps/3.6.md, "Cycle time and lead time", "Age").
 *
 *   - **Cycle time** runs from an item's FIRST entry into Started (its earliest
 *     Started row at or before its completion) to its completion. An item done
 *     without ever being Started has none: it is counted as "Done without
 *     starting".
 *   - **Lead time** runs from its creation (its first recorded row) to its
 *     completion.
 *   - **Age** is an open item's time in Started now: from its first entry into
 *     Started to the moment of reading, for an item whose picture is Started.
 *
 * Each is elapsed working time on the item's own calendar (`elapsed.ts`); this
 * module finds the instants. Pure. Written fresh for Islestone.
 */
import { completionAsOf } from './completion';
import { pictureAt, type RecordFact } from './record';

/** The instants a completed item's durations are measured between. */
export interface CompletionInstants<T extends RecordFact = RecordFact> {
    workItemId: string;
    /** The completion row (its recorded project and team). */
    row: T;
    completedAt: Date;
    /** The first entry into Started at or before the completion; null: done without starting. */
    startedAt: Date | null;
    /** The first recorded row. */
    createdAt: Date;
}

/** One item's completion instants as of `asOf` (ms); null when it is not completed. */
export function completionInstantsAsOf<T extends RecordFact>(rows: readonly T[], asOf: number): CompletionInstants<T> | null {
    const c = completionAsOf(rows, asOf);
    if (!c) return null;
    const done = c.row.at.getTime();
    let startedAt: Date | null = null;
    for (const r of rows) {
        if (r.at.getTime() > done) break;
        if (r.stateCategory === 'STARTED') {
            startedAt = r.at;
            break;
        }
    }
    return { workItemId: c.workItemId, row: c.row, completedAt: c.row.at, startedAt, createdAt: rows[0]!.at };
}

/** An open, started item's first start, as of `asOf`; null unless its picture is Started and live. */
export function ageStartAsOf<T extends RecordFact>(rows: readonly T[], asOf: number): { workItemId: string; row: T; startedAt: Date } | null {
    const picture = pictureAt(rows, asOf);
    if (!picture || picture.deleted || picture.stateCategory !== 'STARTED') return null;
    const first = rows.find((r) => r.stateCategory === 'STARTED' && r.at.getTime() <= asOf)!;
    return { workItemId: picture.workItemId, row: picture, startedAt: first.at };
}
