/**
 * The scale seed's pure parts (Hardening H2a, `scripts/seed-scale/`): the
 * named random streams, the Zipf skew, the shapes of decision 170 and the
 * per-project plan. The plan is what both writers read, so the invariants the
 * database would refuse (an acyclic BLOCKS graph, parents before children and
 * at most five levels, nobody waited on by a closed item) are held here first.
 */
import { BLOCKS_WINDOW, planProject, isClosedState, type PlanContext } from '../../../scripts/seed-scale/plan';
import { stream, zipf } from '../../../scripts/seed-scale/random';
import { prefixFor, RATIOS, sampleCount, SHAPES, shapeItemCount } from '../../../scripts/seed-scale/shapes';
import { description, title } from '../../../scripts/seed-scale/text';

const ctx: PlanContext = {
    size: 2_000,
    anchor: new Date(Date.UTC(2026, 10, 21)),
    assignable: 37,
    members: 40,
    writers: 37,
    labels: 12,
    pastCycles: 13,
    cycles: 26,
    milestones: 3,
};

describe('named streams', () => {
    it('the same seed and name give the same draws; another name gives others', () => {
        const a = Array.from({ length: 5 }, ((r) => () => r.next())(stream('s', 'x')));
        const b = Array.from({ length: 5 }, ((r) => () => r.next())(stream('s', 'x')));
        const c = Array.from({ length: 5 }, ((r) => () => r.next())(stream('s', 'y')));
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
    });

    it('ids are cuid-shaped and distinct', () => {
        const r = stream('s', 'ids');
        const ids = Array.from({ length: 1000 }, () => r.id());
        expect(new Set(ids).size).toBe(1000);
        expect(ids.every((id) => /^c[0-9a-z]{24}$/.test(id))).toBe(true);
    });
});

describe('zipf', () => {
    it('rank 0 is drawn far more often than the median rank, and every draw is in range', () => {
        const draw = zipf(40);
        const r = stream('s', 'zipf');
        const counts = new Array<number>(40).fill(0);
        for (let i = 0; i < 20_000; i++) counts[draw(r)]!++;
        expect(counts.every((n) => n >= 0)).toBe(true);
        expect(counts[0]!).toBeGreaterThan(counts[20]! * 10);
    });
});

describe('the shapes (decision 170)', () => {
    it('10k is ten projects of 1,000; 100k is twenty, one of 20,000 and nineteen sharing the rest', () => {
        expect(shapeItemCount(SHAPES['10k'])).toBe(10_000);
        expect(SHAPES['10k'].projects).toEqual(new Array(10).fill(1_000));
        expect(shapeItemCount(SHAPES['100k'])).toBe(100_000);
        expect(Math.max(...SHAPES['100k'].projects)).toBe(20_000);
        expect(SHAPES['100k'].projects).toHaveLength(20);
        expect(SHAPES['100k'].projects.filter((n) => n === 4_210 || n === 4_211)).toHaveLength(19);
    });

    it('the sample is 1 % of a project, at least one item (decision 171)', () => {
        expect(sampleCount(1_000)).toBe(10);
        expect(sampleCount(20_000)).toBe(200);
        expect(sampleCount(30)).toBe(1);
    });

    it('project prefixes are distinct valid keys', () => {
        const prefixes = Array.from({ length: 30 }, (_, i) => prefixFor(i));
        expect(new Set(prefixes).size).toBe(30);
        expect(prefixes.every((p) => /^[A-Z][A-Z0-9]{1,9}$/.test(p))).toBe(true);
    });
});

describe('planProject', () => {
    const plans = planProject(stream('s', 'items:AA'), ctx);

    it('is deterministic', () => {
        expect(planProject(stream('s', 'items:AA'), ctx)).toEqual(plans);
    });

    it('parents come first and nest at most five levels', () => {
        const depth: number[] = [];
        for (const p of plans) {
            if (p.parent !== null) expect(p.parent).toBeLessThan(p.index);
            depth.push(p.parent === null ? 0 : depth[p.parent]! + 1);
        }
        expect(Math.max(...depth)).toBeLessThanOrEqual(4);
    });

    it('blocks only later items of the project, so the BLOCKS graph is acyclic', () => {
        for (const p of plans) for (const to of p.blocks) expect(to > p.index && to < ctx.size && to - p.index <= BLOCKS_WINDOW).toBe(true);
    });

    it('a closed item waits on nobody and sits only in a past cycle; an open one only in a current or later one', () => {
        for (const p of plans) {
            if (isClosedState(p.state)) {
                expect(p.waitingOn).toBeNull();
                if (p.cycle !== null) expect(p.cycle).toBeLessThan(ctx.pastCycles);
            } else if (p.cycle !== null) {
                expect(p.cycle).toBeGreaterThanOrEqual(ctx.pastCycles);
            }
        }
    });

    it('a sub-item of a deleted item is deleted with it, and a start never follows its due date', () => {
        for (const p of plans) {
            if (p.parent !== null && plans[p.parent]!.deletedAt) expect(p.deletedAt).toEqual(plans[p.parent]!.deletedAt);
            if (p.startDate && p.dueDate) expect(p.startDate <= p.dueDate).toBe(true);
        }
    });

    it('keeps the ratios of the map, near enough', () => {
        const share = (f: (p: (typeof plans)[number]) => boolean) => plans.filter(f).length / plans.length;
        expect(share((p) => p.state === 'Done')).toBeCloseTo(0.45, 1);
        expect(share((p) => p.description !== null)).toBeCloseTo(RATIOS.described, 1);
        expect(share((p) => p.parent !== null)).toBeGreaterThan(0.1);
        const comments = plans.reduce((s, p) => s + p.comments.length, 0) / plans.length;
        expect(comments).toBeGreaterThan(2.5);
        expect(comments).toBeLessThan(3.5);
    });
});

describe('generated text', () => {
    it('mixes Cyrillic and Latin words', () => {
        const r = stream('s', 'text');
        const texts = Array.from({ length: 100 }, () => `${title(r)} ${description(r)}`).join(' ');
        expect(/[а-я]/.test(texts)).toBe(true);
        expect(/[a-z]/.test(texts)).toBe(true);
    });
});
