/**
 * The transition record as facts (sub-phase 3.6a; docs/porting/maps/3.6.md,
 * "Reconstruction"; ADR 0014 §1). Each `WorkItemTransition` row is the item's
 * picture right after a change; an item's picture at an instant is its latest
 * row at or before that instant, ties broken by the row's sequence id (2.5a's
 * rule, unchanged). Every measure groups facts by item through this module,
 * and every SQL read that aggregates in the database implements the same
 * rule (each has a property test against these functions).
 *
 * Pure: no database, no clock. Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

/** One row of the record, as the measures read it. */
export interface RecordFact {
    workItemId: string;
    projectId: string;
    teamId: string;
    stateCategory: WorkflowStateCategory;
    cycleId: string | null;
    /** Since 2.5b; NULL before. */
    milestoneId?: string | null;
    deleted: boolean;
    at: Date;
    /** The row's sequence id: the order of two changes at one instant. */
    seq: number;
    /** The estimates the row records (3.4a); NULL before. */
    estimatePoints?: number | null;
    estimateMinutes?: number | null;
}

/** The record's order: `at`, then the sequence id. */
export function compareFacts(a: Pick<RecordFact, 'at' | 'seq'>, b: Pick<RecordFact, 'at' | 'seq'>): number {
    const d = a.at.getTime() - b.at.getTime();
    return d !== 0 ? d : a.seq - b.seq;
}

/** Facts grouped by item, each item's rows in the record's order. */
export function byItem<T extends RecordFact>(facts: readonly T[]): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const f of facts) {
        const list = out.get(f.workItemId);
        if (list) list.push(f);
        else out.set(f.workItemId, [f]);
    }
    for (const list of out.values()) list.sort(compareFacts);
    return out;
}

/** The latest row at or before `instant` (ms), of one item's rows in order; null when none. */
export function pictureAt<T extends RecordFact>(rows: readonly T[], instant: number): T | null {
    let found: T | null = null;
    for (const r of rows) {
        if (r.at.getTime() > instant) break;
        found = r;
    }
    return found;
}

/**
 * A completion row (owner decision 310): the item enters Done, from another
 * category or at its creation. The database spells it `"stateCategory" =
 * 'DONE' AND "fromStateCategory" IS DISTINCT FROM 'DONE'`, where
 * `fromStateCategory` is the previous row's category (NULL on the first).
 */
export function isCompletionRow(row: Pick<RecordFact, 'stateCategory'>, previous: Pick<RecordFact, 'stateCategory'> | null): boolean {
    return row.stateCategory === 'DONE' && (previous === null || previous.stateCategory !== 'DONE');
}
