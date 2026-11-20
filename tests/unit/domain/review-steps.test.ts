/**
 * The rules of a review step (sub-phase 2.8a; ADR 0009; owner decisions 156
 * and 162): property tests over random reviewer sets and responses, and the
 * round's next move.
 */
import fc from 'fast-check';

import { afterStepEnds, evaluateStep, nextPendingStep, type ReviewerState } from '@/app-layer/domain/review-steps';

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
