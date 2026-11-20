/**
 * Pure tests for the workspace search's ranking helpers (sub-phase 2.7b).
 *
 * Copied from inflect-compliance `tests/unit/search-rank.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and edited for
 * Islestone's two hit types: work items (code: the key) and projects (code:
 * the key prefix). The relative bands MUST keep their pecking order — exact
 * > prefix > title-substring > subtitle-substring — or the palette starts
 * surfacing weak matches before strong ones.
 */

import { capPerType, computeRankScore, sortHits } from '@/lib/search/rank';
import type { SearchHit } from '@/lib/search/types';

describe('computeRankScore — match bands', () => {
    it('exact title match outranks prefix match', () => {
        const exact = computeRankScore('login', { type: 'workItem', title: 'login' });
        const prefix = computeRankScore('log', { type: 'workItem', title: 'login' });
        expect(exact).toBeGreaterThan(prefix);
    });

    it('an exact key outranks a substring title match, whatever the case', () => {
        const key = computeRankScore('isl-12', { type: 'workItem', title: 'Fix the redirect', code: 'ISL-12' });
        const substr = computeRankScore('redirect', { type: 'workItem', title: 'Fix the redirect' });
        expect(key).toBeGreaterThan(substr);
        expect(key).toBeGreaterThanOrEqual(100);
    });

    it('an exact key prefix ranks a project as an exact match', () => {
        expect(computeRankScore('isl', { type: 'project', title: 'Islestone', code: 'ISL' })).toBe(100);
    });

    it('prefix match outranks substring title match', () => {
        const prefix = computeRankScore('fix', { type: 'workItem', title: 'Fix the redirect' });
        const substr = computeRankScore('redir', { type: 'workItem', title: 'Fix the redirect' });
        expect(prefix).toBeGreaterThan(substr);
    });

    it('title substring outranks subtitle-only substring', () => {
        const titleHit = computeRankScore('access', { type: 'project', title: 'Unauthorised access' });
        const subtitleHit = computeRankScore('access', { type: 'project', title: 'Phishing', subtitle: 'Access team' });
        expect(titleHit).toBeGreaterThan(subtitleHit);
    });

    it('an empty code never makes every query a prefix match', () => {
        expect(computeRankScore('zzz', { type: 'project', title: 'anything', code: '' })).toBe(0);
    });

    it('case-insensitive matching', () => {
        expect(computeRankScore('LOGIN', { type: 'workItem', title: 'login page' })).toBe(
            computeRankScore('login', { type: 'workItem', title: 'login page' }),
        );
    });

    it('returns 0 for empty query', () => {
        expect(computeRankScore('', { type: 'workItem', title: 'anything' })).toBe(0);
        expect(computeRankScore('   ', { type: 'workItem', title: 'anything' })).toBe(0);
    });

    it('a word match no band names (words in another order) scores the baseline only', () => {
        // The full-text index finds "redirect login" in "Login redirect"; it
        // ranks below every substring hit.
        const words = computeRankScore('redirect login', { type: 'workItem', title: 'Login redirect' });
        expect(words).toBe(1);
        expect(words).toBeLessThan(computeRankScore('redirect', { type: 'project', title: 'Login redirect' }));
    });

    it('type baseline cannot promote a weak match over a strong one', () => {
        const weakItem = computeRankScore('direc', { type: 'workItem', title: 'Redirect' });
        const strongProject = computeRankScore('billing', { type: 'project', title: 'billing' });
        expect(strongProject).toBeGreaterThan(weakItem);
    });
});

function hit(id: string, type: SearchHit['type'], score: number): SearchHit {
    return {
        id,
        type,
        title: id,
        subtitle: null,
        badge: null,
        href: `/x/${id}`,
        score,
        iconKey: type === 'workItem' ? 'work-item' : 'project',
        category: 'X',
    };
}

describe('sortHits', () => {
    it('orders by score DESC', () => {
        expect(sortHits([hit('a', 'workItem', 10), hit('b', 'workItem', 50), hit('c', 'workItem', 30)]).map((h) => h.id)).toEqual(['b', 'c', 'a']);
    });

    it('breaks ties by type baseline (work item > project)', () => {
        expect(sortHits([hit('p1', 'project', 30), hit('w1', 'workItem', 30)]).map((h) => h.id)).toEqual(['w1', 'p1']);
    });

    it('breaks remaining ties by id, by code unit (deterministic)', () => {
        expect(sortHits([hit('z', 'workItem', 30), hit('a', 'workItem', 30), hit('B', 'workItem', 30)]).map((h) => h.id)).toEqual(['B', 'a', 'z']);
    });
});

describe('capPerType', () => {
    it('keeps everything when under the cap', () => {
        const out = capPerType([hit('w1', 'workItem', 50), hit('p1', 'project', 40)], 5);
        expect(out.kept).toHaveLength(2);
        expect(out.truncated).toBe(false);
        expect(out.perTypeCounts).toEqual({ workItem: 1, project: 1 });
    });

    it('caps each type independently and flags truncated', () => {
        const out = capPerType([hit('w1', 'workItem', 50), hit('w2', 'workItem', 49), hit('w3', 'workItem', 48), hit('p1', 'project', 40)], 2);
        expect(out.kept.map((h) => h.id)).toEqual(['w1', 'w2', 'p1']);
        expect(out.perTypeCounts).toEqual({ workItem: 2, project: 1 });
        expect(out.truncated).toBe(true);
    });

    it('zero-fills perTypeCounts', () => {
        expect(capPerType([], 5)).toEqual({ kept: [], perTypeCounts: { workItem: 0, project: 0 }, truncated: false });
    });

    it('respects the input order — caller must pre-sort by score', () => {
        expect(capPerType([hit('low', 'workItem', 10), hit('high', 'workItem', 90)], 1).kept.map((h) => h.id)).toEqual(['low']);
    });
});
