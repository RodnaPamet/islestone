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
