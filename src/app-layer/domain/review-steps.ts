/**
 * The rules of a review step (sub-phase 2.8a; ADR 0009; owner decisions 156
 * and 162), pure and client-safe: the usecases decide with them and the
 * detail (2.8b) shows what they say, so the two never disagree.
 *
 *   - An "all" step (`ALL`) completes when every reviewer still asked has
 *     signed off **and at least one has**: zero is never complete (inflect
 *     legacy-access invariant 5, pattern only). One Return returns it at once
 *     (decision 156).
 *   - An "any" step (`ANY`) is decided by its first response, either way.
 *   - A step with nobody still asked stays open (`noReviewersLeft`): it never
 *     completes by an empty `every`; a person skips it, adds a reviewer or
 *     withdraws the round.
 *
 * Written fresh for Islestone.
 */

export type ReviewStepModeValue = 'ALL' | 'ANY';
export type ReviewOutcomeValue = 'SIGNED_OFF' | 'RETURNED';

/** Bounds the usecases and the request schemas share. */
export const REVIEW_LIMITS = {
    /** Steps in one round. */
    maxSteps: 10,
    /** Members named directly on one step. */
    maxMembersPerStep: 25,
    /** Recipient lists named on one step. */
    maxListsPerStep: 5,
    /** A step's name. */
    stepNameMax: 120,
    /** The working days a step is due after it opens. */
    minDueInWorkingDays: 1,
    maxDueInWorkingDays: 60,
    /** A response's text (decision 157). */
    responseTextMax: 4000,
} as const;

/** One reviewer as the rules see them. */
export interface ReviewerState {
    outcome: ReviewOutcomeValue | null;
    /** Withdrawn: no longer asked (left, removed, the step ended, became the assignee). */
    withdrawn: boolean;
}

export type StepVerdict = 'OPEN' | 'COMPLETED' | 'RETURNED';

export interface StepEvaluation {
    verdict: StepVerdict;
    /** Open, with nobody still asked: flagged, never completed. */
    noReviewersLeft: boolean;
    /** The reviewers still asked who have not responded. */
    pendingCount: number;
}

/** What a step's reviewers decide, now. */
export function evaluateStep(mode: ReviewStepModeValue, reviewers: readonly ReviewerState[]): StepEvaluation {
    const asked = reviewers.filter((r) => !r.withdrawn);
    const pendingCount = asked.filter((r) => r.outcome === null).length;
    const returned = asked.some((r) => r.outcome === 'RETURNED');
    const signed = asked.filter((r) => r.outcome === 'SIGNED_OFF').length;
    if (returned) return { verdict: 'RETURNED', noReviewersLeft: false, pendingCount };
    if (mode === 'ANY') {
        if (signed > 0) return { verdict: 'COMPLETED', noReviewersLeft: false, pendingCount };
    } else if (asked.length > 0 && signed === asked.length) {
        return { verdict: 'COMPLETED', noReviewersLeft: false, pendingCount };
    }
    return { verdict: 'OPEN', noReviewersLeft: asked.length === 0, pendingCount };
}

/** The next step to open after `position`: the first PENDING step by position, or null when none is left. */
export function nextPendingStep<T extends { position: number; status: string }>(steps: readonly T[], afterPosition = 0): T | null {
    let best: T | null = null;
    for (const s of steps) {
        if (s.status !== 'PENDING' || s.position <= afterPosition) continue;
        if (!best || s.position < best.position) best = s;
    }
    return best;
}

/**
 * How a round ends once a step has been decided: a returned step ends the
 * round `RETURNED`; a completed or skipped one opens the next PENDING step,
 * or, with none left, completes the round.
 */
export function afterStepEnds(
    endedAs: 'COMPLETED' | 'RETURNED' | 'SKIPPED',
    next: { id: string } | null,
): { kind: 'ROUND_RETURNED' } | { kind: 'OPEN_NEXT'; stepId: string } | { kind: 'ROUND_COMPLETED' } {
    if (endedAs === 'RETURNED') return { kind: 'ROUND_RETURNED' };
    if (next) return { kind: 'OPEN_NEXT', stepId: next.id };
    return { kind: 'ROUND_COMPLETED' };
}

// ─── The item's review at a glance (sub-phase 2.8b) ───────────────────────

export type ReviewRoundStatusValue = 'PLANNED' | 'OPEN' | 'COMPLETED' | 'RETURNED' | 'WITHDRAWN';

/**
 * Where an item's review stands, as the list column and the board card show
 * it (sub-phase 2.8b): read from its newest round and, when that one is a
 * round planned after another ended, from the one before it.
 *
 *   - `open`: a round is open; `step` names its open step, when its due day
 *     falls and how many reviewers it still waits on.
 *   - `signedOff`: the newest round completed.
 *   - `returned`: the newest ended round was returned (a new round is planned
 *     after it, waiting to be sent: decision 155).
 *   - `withdrawn`: the newest ended round was withdrawn (by a person, or by
 *     the item closing or being deleted).
 *   - `planned`: steps are planned and no round has been sent yet.
 */
export type ReviewSummaryState = 'planned' | 'open' | 'signedOff' | 'returned' | 'withdrawn';

export interface ReviewSummary {
    state: ReviewSummaryState;
    /** The number of the round the state is about (the open, completed, returned or withdrawn one). */
    roundNumber: number;
    /** The open step, while a round is open. */
    step: { name: string; dueOn: string | null; pendingCount: number } | null;
}

/** One round as the summary reads it: newest first, its OPEN step (at most one) with its pending reviewers. */
export interface ReviewSummaryRound {
    number: number;
    status: ReviewRoundStatusValue;
    /** Every step of the round, whatever its status. */
    stepCount: number;
    /** Its OPEN step, if any (at most one). */
    steps: ReadonlyArray<{ name: string; dueOn: string | null; pendingCount: number }>;
}

/** The summary of an item's newest rounds (newest first), or null when it has none. */
export function reviewSummaryOf(rounds: readonly ReviewSummaryRound[]): ReviewSummary | null {
    const [latest, previous] = rounds;
    if (!latest) return null;
    const ended = (r: ReviewSummaryRound): ReviewSummary | null => {
        if (r.status === 'COMPLETED') return { state: 'signedOff', roundNumber: r.number, step: null };
        if (r.status === 'RETURNED') return { state: 'returned', roundNumber: r.number, step: null };
        if (r.status === 'WITHDRAWN') return { state: 'withdrawn', roundNumber: r.number, step: null };
        return null;
    };
    if (latest.status === 'OPEN') {
        const step = latest.steps[0];
        return { state: 'open', roundNumber: latest.number, step: step ? { name: step.name, dueOn: step.dueOn, pendingCount: step.pendingCount } : null };
    }
    if (latest.status === 'PLANNED') {
        // A round planned after another ended says how that one ended.
        const before = previous ? ended(previous) : null;
        if (before) return before;
        // A planned round with no steps left is no review at all.
        return latest.stepCount > 0 ? { state: 'planned', roundNumber: latest.number, step: null } : null;
    }
    return ended(latest);
}

/**
 * "Changed since signed off" (decision 163): the item stays editable during a
 * round, and a sign-off records the item's version. While its round is OPEN,
 * a sign-off made at an earlier version than the item's now was given on
 * work that has changed since. An ended round is not marked: ending it
 * names the assignee as waiting on (decision 152), which is itself a write
 * of the item, so the version no longer says whether the work changed.
 */
export function changedSinceSignedOff(
    reviewer: { outcome: ReviewOutcomeValue | null; itemVersionAt: number | null; withdrawnAt?: string | Date | null },
    roundStatus: ReviewRoundStatusValue,
    itemVersion: number,
): boolean {
    return (
        roundStatus === 'OPEN' &&
        reviewer.outcome === 'SIGNED_OFF' &&
        !reviewer.withdrawnAt &&
        reviewer.itemVersionAt !== null &&
        reviewer.itemVersionAt < itemVersion
    );
}

/** One round as the Done check reads it (sub-phase 2.8c): any status, with its step count and its open step. */
export interface DoneCheckRound {
    number: number;
    status: ReviewRoundStatusValue;
    stepCount: number;
    /** The name of its OPEN step, if any. */
    openStepName: string | null;
}

/** Why a move into Done is held: the round that stands in its way. */
export interface ReviewHold {
    roundNumber: number;
    status: Exclude<ReviewRoundStatusValue, 'COMPLETED'>;
    openStepName: string | null;
}

/**
 * The per-type Done check (sub-phase 2.8c; ADR 0009 §14; owner decision 149):
 * for an item whose type requires its review to finish before Done, what
 * holds a move into Done, or null when nothing does.
 *
 * The review that must finish is the item's newest round that has at least
 * one step: a planned round with no steps left is no review at all (as
 * `reviewSummaryOf` reads it). An item with no such round is not held (a
 * type with no default steps holds nothing, and Settings says so). Held when
 * that round is not COMPLETED: planned and not sent, open, returned (a new
 * round is planned after it), or withdrawn (a person withdrew it, or the item
 * was closed or deleted while it was open; reopening does not reopen it).
 * Cancelling is never held: the caller asks only for a move into DONE.
 */
export function reviewHoldsDone(rounds: readonly DoneCheckRound[]): ReviewHold | null {
    let newest: DoneCheckRound | null = null;
    for (const r of rounds) if (r.stepCount > 0 && (!newest || r.number > newest.number)) newest = r;
    if (!newest || newest.status === 'COMPLETED') return null;
    return { roundNumber: newest.number, status: newest.status, openStepName: newest.status === 'OPEN' ? newest.openStepName : null };
}

/** The sentence a held move answers with: the item's key and the round that holds it. */
export function reviewHoldMessage(key: string, hold: ReviewHold): string {
    const why =
        hold.status === 'OPEN'
            ? hold.openStepName
                ? `round ${hold.roundNumber} is open at the step "${hold.openStepName}"`
                : `round ${hold.roundNumber} is open`
            : hold.status === 'PLANNED'
              ? `round ${hold.roundNumber} is planned and has not been sent for review`
              : hold.status === 'RETURNED'
                ? `round ${hold.roundNumber} was returned; send the next round and finish it`
                : `round ${hold.roundNumber} was withdrawn; send a new round and finish it`;
    return `${key} cannot move to Done until its review is complete: ${why}. Cancelling is always allowed.`;
}
