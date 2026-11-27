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

/**
 * One item's rows as the forecast's record read gives them (sub-phase 3.6c):
 * from its first completion in the read's range on, each with the category it
 * came from (`fromStateCategory`, decision 310) and whether, as a completion
 * row, it lies in the history's scope.
 */
export interface SpanRow {
    at: Date;
    seq: number;
    stateCategory: RecordFact['stateCategory'];
    fromStateCategory: RecordFact['stateCategory'] | null;
    deleted: boolean;
    /** A completion row whose recorded project is in the history's scope (and visible). */
    inScope: boolean;
}

/** A completion and the instants between which it counted: from `from` (inclusive) to `to` (exclusive; null: still now). */
export interface CompletionSpan {
    completedAt: Date;
    from: Date;
    to: Date | null;
}

/**
 * When each of one item's completions counted (decision 311, over time): it
 * counts while the item's picture is in Done and not deleted, on the day of
 * its last entry into Done; a reopen ends it for good (a later entry is a new
 * completion), a deletion ends it and a restore begins it again. Only
 * completions whose row is in scope are returned. `completionAsOf(rows, R)`
 * finds a completion exactly when one of these spans holds `R`.
 */
export function completionSpans(rows: readonly SpanRow[]): CompletionSpan[] {
    const out: CompletionSpan[] = [];
    let last: SpanRow | null = null;
    let open: { completedAt: Date; inScope: boolean; from: Date } | null = null;
    for (const r of rows) {
        if (r.stateCategory === 'DONE' && r.fromStateCategory !== 'DONE') last = r;
        const counted = last !== null && r.stateCategory === 'DONE' && !r.deleted;
        if (counted && !open) open = { completedAt: last!.at, inScope: last!.inScope, from: r.at };
        else if (!counted && open) {
            if (open.inScope) out.push({ completedAt: open.completedAt, from: open.from, to: r.at });
            open = null;
        }
    }
    if (open?.inScope) out.push({ completedAt: open.completedAt, from: open.from, to: null });
    return out;
}

/**
 * Spans as civil days (the back-test's `DaySpan`): the completion's day, and
 * the days at whose start it counted. A row at an instant counts for a
 * reading after it, so a span from `f` to `t` counts at the start of every
 * day from the day after `f` to the day of `t` (midnight belongs to the day
 * it begins). A span seen at no day's start is dropped.
 */
export function daySpansOf(spans: readonly CompletionSpan[], dayOf: (at: Date) => number): Array<{ day: number; seenFrom: number; seenUntil: number | null }> {
    const out: Array<{ day: number; seenFrom: number; seenUntil: number | null }> = [];
    for (const s of spans) {
        const seenFrom = dayOf(s.from) + 1;
        const seenUntil = s.to === null ? null : dayOf(s.to);
        if (seenUntil !== null && seenUntil < seenFrom) continue;
        out.push({ day: dayOf(s.completedAt), seenFrom, seenUntil });
    }
    return out;
}
