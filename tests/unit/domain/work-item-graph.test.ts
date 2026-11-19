/**
 * Property test for the dependency-cycle refusal (roadmap 2.1, ADR 0002 §6):
 * over random sequences of BLOCKS inserts, the accepted edges never contain a
 * cycle, and an insert is accepted exactly when it keeps the graph acyclic.
 * The SQL twin (the recursive `UNION` under the graph lock) is proved in
 * tests/integration/work-item-graph.test.ts, with a concurrent pair.
 */
import fc from 'fast-check';

import { MAX_SUB_ITEM_DEPTH, fitsDepthCap, hasCycle, wouldCreateCycle } from '@/app-layer/domain/work-item-graph';

const node = fc.integer({ min: 0, max: 9 }).map((n) => `n${n}`);

describe('wouldCreateCycle — properties', () => {
    it('accepted edges never contain a cycle, and an insert is accepted exactly when the graph stays acyclic', () => {
        fc.assert(
            fc.property(fc.array(fc.tuple(node, node), { maxLength: 60 }), (inserts) => {
                const accepted: Array<[string, string]> = [];
                for (const [from, to] of inserts) {
                    const refused = wouldCreateCycle(accepted, from, to);
                    const wouldCycle = hasCycle([...accepted, [from, to]]);
                    if (refused !== wouldCycle) return false;
                    if (!refused) accepted.push([from, to]);
                }
                return !hasCycle(accepted);
            }),
            { numRuns: 1000 },
        );
    });

    it('a self edge is always refused', () => {
        fc.assert(fc.property(node, (n) => wouldCreateCycle([], n, n)));
    });
});

describe('hasCycle (the oracle)', () => {
    it('finds a cycle and an acyclic chain', () => {
        expect(hasCycle([['a', 'b'], ['b', 'c'], ['c', 'a']])).toBe(true);
        expect(hasCycle([['a', 'b'], ['b', 'c'], ['a', 'c']])).toBe(false);
        expect(hasCycle([])).toBe(false);
    });
});

describe('the sub-item depth cap (5 levels, owner decision 2026-11-19)', () => {
    it('admits a leaf under depth 4 and refuses one under depth 5', () => {
        expect(MAX_SUB_ITEM_DEPTH).toBe(5);
        expect(fitsDepthCap(4, 0)).toBe(true);
        expect(fitsDepthCap(5, 0)).toBe(false);
    });

    it('counts the moved subtree\'s own height', () => {
        expect(fitsDepthCap(0, 4)).toBe(true);
        expect(fitsDepthCap(1, 4)).toBe(false);
    });
});
