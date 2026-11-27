/**
 * Completion (sub-phase 3.6a, owner decision 311; ADR 0014 §2;
 * docs/porting/maps/3.6.md, "Completion").
 *
 * An item is completed as of a moment `R` when its picture at `R` is in Done
 * and not deleted. Its completion is its last entry into Done at or before
 * `R`, and it counts once, on that day: a reopened item counts at its later
 * completion, a deleted one is retracted from every past day (a restored one
 * returns), a purged one (its last row is its deletion) never counts, and a
 * cancelled one is never completed. Only rows at or before `R` are read, so a
 * back-test never sees the future.
 *
 * Pure. Written fresh for Islestone.
 */
import { isCompletionRow, pictureAt, type RecordFact } from './record';

export interface Completion<T extends RecordFact = RecordFact> {
    workItemId: string;
    /** The completion row: the item's picture as it entered Done (its recorded project, team, cycle and milestone). */
    row: T;
}

/** One item's completion as of `asOf` (ms), from its rows in the record's order; null when not completed. */
export function completionAsOf<T extends RecordFact>(rows: readonly T[], asOf: number): Completion<T> | null {
    const picture = pictureAt(rows, asOf);
    if (!picture || picture.deleted || picture.stateCategory !== 'DONE') return null;
    let last: T | null = null;
    let previous: T | null = null;
    for (const r of rows) {
        if (r.at.getTime() > asOf) break;
        if (isCompletionRow(r, previous)) last = r;
        previous = r;
    }
    return last ? { workItemId: last.workItemId, row: last } : null;
}

/** Every item's completion as of `asOf`, from facts grouped by item. */
export function completionsAsOf<T extends RecordFact>(items: ReadonlyMap<string, readonly T[]>, asOf: number): Completion<T>[] {
    const out: Completion<T>[] = [];
    for (const rows of items.values()) {
        const c = completionAsOf(rows, asOf);
        if (c) out.push(c);
    }
    return out;
}
