/**
 * The rules of a review step (sub-phase 2.8a; ADR 0009; owner decisions 156
 * and 162): property tests over random reviewer sets and responses, and the
 * round's next move; and (2.8b) the summary the list and the board show and
 * "changed since signed off" (decision 163).
 */
import fc from 'fast-check';

import {
    afterStepEnds,
    changedSinceSignedOff,
    evaluateStep,
    nextPendingStep,
    reviewSummaryOf,
    type ReviewerState,
    type ReviewSummaryRound,
} from '@/app-layer/domain/review-steps';

const reviewer = fc.record({
    outcome: fc.constantFrom<ReviewerState['outcome']>(null, 'SIGNED_OFF', 'RETURNED'),
    withdrawn: fc.boolean(),
}).map((r) => (r.withdrawn ? { outcome: null, withdrawn: true } : r)) as fc.Arbitrary<ReviewerState>;
const reviewers = fc.array(reviewer, { maxLength: 12 });

describe('evaluateStep', () => {
    it('an "all" step completes only when every reviewer still asked has signed off and at least one has', () => {
        fc.assert(
            fc.property(reviewers, (rs) => {
                const asked = rs.filter((r) => !r.withdrawn);
                const verdict = evaluateStep('ALL', rs).verdict;
                const allSigned = asked.length > 0 && asked.every((r) => r.outcome === 'SIGNED_OFF');
                return (verdict === 'COMPLETED') === allSigned;
            }),
        );
    });

    it('one Return returns the step at once, whatever else was said (decision 156)', () => {
        fc.assert(
            fc.property(reviewers, fc.constantFrom('ALL' as const, 'ANY' as const), (rs, mode) => {
                const returned = rs.some((r) => !r.withdrawn && r.outcome === 'RETURNED');
                return (evaluateStep(mode, rs).verdict === 'RETURNED') === returned;
            }),
        );
    });

    it('an "any" step completes on a sign-off when nobody returned it', () => {
        fc.assert(
            fc.property(reviewers, (rs) => {
                const asked = rs.filter((r) => !r.withdrawn);
                const want = asked.some((r) => r.outcome === 'RETURNED') ? 'RETURNED' : asked.some((r) => r.outcome === 'SIGNED_OFF') ? 'COMPLETED' : 'OPEN';
                return evaluateStep('ANY', rs).verdict === want;
            }),
        );
    });

    it('zero is never complete: with nobody still asked a step stays open and is flagged', () => {
        fc.assert(
            fc.property(fc.array(fc.constant<ReviewerState>({ outcome: null, withdrawn: true }), { maxLength: 6 }), fc.constantFrom('ALL' as const, 'ANY' as const), (rs, mode) => {
                const e = evaluateStep(mode, rs);
                return e.verdict === 'OPEN' && e.noReviewersLeft && e.pendingCount === 0;
            }),
        );
    });

    it('withdrawing a reviewer who has not responded never returns a step', () => {
        fc.assert(
            fc.property(reviewers, fc.nat(), (rs, i) => {
                const pending = rs.map((r, k) => [r, k] as const).filter(([r]) => !r.withdrawn && r.outcome === null);
                if (pending.length === 0) return true;
                const [, k] = pending[i % pending.length]!;
                const after = rs.map((r, j) => (j === k ? { outcome: null, withdrawn: true } : r));
                const before = evaluateStep('ALL', rs).verdict;
                const now = evaluateStep('ALL', after).verdict;
                return !(before !== 'RETURNED' && now === 'RETURNED');
            }),
        );
    });

    it('counts the pending reviewers', () => {
        expect(evaluateStep('ALL', [{ outcome: null, withdrawn: false }, { outcome: 'SIGNED_OFF', withdrawn: false }, { outcome: null, withdrawn: true }])).toEqual({
            verdict: 'OPEN',
            noReviewersLeft: false,
            pendingCount: 1,
        });
    });
});

describe('nextPendingStep and afterStepEnds', () => {
    const steps = fc.uniqueArray(fc.integer({ min: 1, max: 20 }), { maxLength: 10 }).chain((positions) =>
        fc.tuple(...positions.map((position) => fc.constantFrom('PENDING', 'OPEN', 'COMPLETED', 'SKIPPED', 'WITHDRAWN').map((status) => ({ id: `s${position}`, position, status })))),
    );

    it('never passes over a PENDING step: the next is the lowest PENDING position after the one that ended', () => {
        fc.assert(
            fc.property(steps, fc.integer({ min: 0, max: 20 }), (ss, after) => {
                const next = nextPendingStep(ss, after);
                const pendingAfter = ss.filter((s) => s.status === 'PENDING' && s.position > after);
                if (pendingAfter.length === 0) return next === null;
                return next !== null && next.position === Math.min(...pendingAfter.map((s) => s.position));
            }),
        );
    });

    it('a Return ends the round; a completion or skip opens the next step or completes the round', () => {
        expect(afterStepEnds('RETURNED', { id: 'n' })).toEqual({ kind: 'ROUND_RETURNED' });
        expect(afterStepEnds('COMPLETED', { id: 'n' })).toEqual({ kind: 'OPEN_NEXT', stepId: 'n' });
        expect(afterStepEnds('SKIPPED', null)).toEqual({ kind: 'ROUND_COMPLETED' });
    });
});

// ─── 2.8b: the review at a glance, and "changed since signed off" ─────────

describe('reviewSummaryOf', () => {
    const round = (number: number, status: ReviewSummaryRound['status'], over: Partial<ReviewSummaryRound> = {}): ReviewSummaryRound => ({
        number,
        status,
        stepCount: 2,
        steps: [],
        ...over,
    });

    it('is nothing for an item with no round, or a planned round with no steps left', () => {
        expect(reviewSummaryOf([])).toBeNull();
        expect(reviewSummaryOf([round(1, 'PLANNED', { stepCount: 0 })])).toBeNull();
    });

    it('names the open step, its due day and how many it waits on while a round is open', () => {
        expect(reviewSummaryOf([round(2, 'OPEN', { steps: [{ name: 'Legal', dueOn: '2026-11-25', pendingCount: 2 }] }), round(1, 'RETURNED')])).toEqual({
            state: 'open',
            roundNumber: 2,
            step: { name: 'Legal', dueOn: '2026-11-25', pendingCount: 2 },
        });
    });

    it('says how the last ended round ended while the next one waits to be sent', () => {
        expect(reviewSummaryOf([round(2, 'PLANNED'), round(1, 'RETURNED')])).toEqual({ state: 'returned', roundNumber: 1, step: null });
        expect(reviewSummaryOf([round(2, 'PLANNED'), round(1, 'WITHDRAWN')])).toEqual({ state: 'withdrawn', roundNumber: 1, step: null });
        expect(reviewSummaryOf([round(1, 'PLANNED')])).toEqual({ state: 'planned', roundNumber: 1, step: null });
    });

    it('reads an ended newest round as it ended', () => {
        expect(reviewSummaryOf([round(3, 'COMPLETED'), round(2, 'RETURNED')])).toEqual({ state: 'signedOff', roundNumber: 3, step: null });
        expect(reviewSummaryOf([round(1, 'WITHDRAWN')])).toEqual({ state: 'withdrawn', roundNumber: 1, step: null });
        // A planned round after a completed one is a new review being planned.
        expect(reviewSummaryOf([round(4, 'PLANNED'), round(3, 'COMPLETED')])).toEqual({ state: 'signedOff', roundNumber: 3, step: null });
    });
});

describe('changedSinceSignedOff (decision 163)', () => {
    const signed = { outcome: 'SIGNED_OFF' as const, itemVersionAt: 4, withdrawnAt: null };

    it('marks a sign-off given at an earlier version while its round is open', () => {
        expect(changedSinceSignedOff(signed, 'OPEN', 5)).toBe(true);
        expect(changedSinceSignedOff(signed, 'OPEN', 4)).toBe(false);
    });

    it('never marks a Return, a pending or withdrawn reviewer, or an ended round', () => {
        expect(changedSinceSignedOff({ ...signed, outcome: 'RETURNED' }, 'OPEN', 9)).toBe(false);
        expect(changedSinceSignedOff({ outcome: null, itemVersionAt: null, withdrawnAt: null }, 'OPEN', 9)).toBe(false);
        expect(changedSinceSignedOff({ ...signed, withdrawnAt: '2026-11-20T10:00:00.000Z' }, 'OPEN', 9)).toBe(false);
        for (const status of ['COMPLETED', 'RETURNED', 'WITHDRAWN', 'PLANNED'] as const) expect(changedSinceSignedOff(signed, status, 9)).toBe(false);
    });
});
