/**
 * The latency harness's rules (Hardening H2b; `scripts/perf/lib.mjs`,
 * `scripts/perf/run.mjs`, `scripts/perf/budgets.json`; docs/performance.md,
 * "Latency"; owner decisions 167 to 169).
 *
 * The harness is trusted to say three things: that a run measured something
 * (a run that did not is red everywhere), that a budget was missed only
 * after the tolerance and a re-run (the nightly), and that the budgets are
 * the owner's table or below it. Each is shown to refuse here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { budgetProblems, judge, judgeRatios, knownFindingAt, refusalsOf, renderMarkdown, summarise, verdictOf, type Attempt, type Budgets, type ScenarioResult } from '../../../scripts/perf/lib.mjs';
import { functionBodyOf } from '../../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../../..');
const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/perf/budgets.json'), 'utf8')) as Budgets;
const runSource = fs.readFileSync(path.join(ROOT, 'scripts/perf/run.mjs'), 'utf8');

/**
 * Decision 167's table (docs/porting/maps/H2.md part 1.4), and for the
 * timeline H3's (docs/porting/maps/3.1.md, "Performance"), and for the
 * roadmap 3.2c's (docs/porting/maps/3.2.md, "The read"), and for time 3.4's
 * in decision 167's terms (docs/porting/maps/3.4.md, "Performance": a week
 * at the list's first page, an item's time p95 200, the totals at the board
 * load's, adding time at a write's), and for the workload read and the
 * time-off write 3.5's (docs/porting/maps/3.5.md, "Performance"; the write
 * at the other writes' 400 ms), and for analytics 3.6a's
 * (docs/porting/maps/3.6.md, "Performance"): the ceiling of every budget. A
 * budget may go down; it never goes above these.
 */
const DECIDED: Record<string, Record<'10k' | '100k', { p50?: number; p95: number }>> = {
    'list-project': { '10k': { p50: 80, p95: 200 }, '100k': { p50: 100, p95: 250 } },
    'list-workspace-due': { '10k': { p50: 120, p95: 300 }, '100k': { p50: 180, p95: 450 } },
    'list-custom-field-sort': { '10k': { p50: 150, p95: 350 }, '100k': { p50: 250, p95: 600 } },
    'list-q': { '10k': { p50: 150, p95: 350 }, '100k': { p50: 250, p95: 600 } },
    'board-column': { '10k': { p50: 80, p95: 200 }, '100k': { p50: 100, p95: 250 } },
    'board-load': { '10k': { p50: 250, p95: 500 }, '100k': { p50: 300, p95: 700 } },
    search: { '10k': { p50: 100, p95: 250 }, '100k': { p50: 200, p95: 500 } },
    detail: { '10k': { p50: 50, p95: 120 }, '100k': { p50: 50, p95: 120 } },
    'detail-sheet': { '10k': { p50: 150, p95: 350 }, '100k': { p50: 150, p95: 350 } },
    'my-work': { '10k': { p50: 300, p95: 600 }, '100k': { p50: 400, p95: 800 } },
    timeline: { '10k': { p50: 400, p95: 900 }, '100k': { p50: 400, p95: 900 } },
    roadmap: { '10k': { p50: 300, p95: 700 }, '100k': { p50: 300, p95: 700 } },
    workload: { '10k': { p50: 250, p95: 600 }, '100k': { p50: 400, p95: 900 } },
    'time-off-set': { '10k': { p95: 400 }, '100k': { p95: 400 } },
    // 3.6a's (docs/porting/maps/3.6.md, "Performance"): the workspace's throughput and the largest project's flow.
    'analytics-throughput': { '10k': { p50: 200, p95: 400 }, '100k': { p50: 200, p95: 400 } },
    'analytics-flow': { '10k': { p50: 350, p95: 700 }, '100k': { p50: 350, p95: 700 } },
    // Decision 337 (3.6b): time waiting in the largest project, at the flow's budget.
    'analytics-waiting': { '10k': { p50: 350, p95: 700 }, '100k': { p50: 350, p95: 700 } },
    create: { '10k': { p95: 400 }, '100k': { p95: 400 } },
    edit: { '10k': { p95: 400 }, '100k': { p95: 400 } },
    move: { '10k': { p95: 400 }, '100k': { p95: 400 } },
    reorder: { '10k': { p95: 400 }, '100k': { p95: 400 } },
    'bulk-state': { '10k': { p95: 2000 }, '100k': { p95: 2000 } },
    'time-week': { '10k': { p50: 80, p95: 200 }, '100k': { p50: 100, p95: 250 } },
    'time-item': { '10k': { p50: 80, p95: 200 }, '100k': { p50: 80, p95: 200 } },
    'time-totals': { '10k': { p50: 250, p95: 500 }, '100k': { p50: 300, p95: 700 } },
    'time-add': { '10k': { p95: 400 }, '100k': { p95: 400 } },
};
const DECIDED_BROWSER: Record<string, number> = { list: 1300, board: 2000, detail: 600, timeline: 2000 };

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const summaryOf = (p50: number, p95: number) => ({ count: 200, p50, p95, p99: p95, min: 1, max: p95, mean: p50 });
const attempt = (over: Partial<Attempt> = {}): Attempt => ({ samples: 200, ok: 200, statuses: { 200: 200 }, problems: [], summary: summaryOf(40, 90), verdict: null, ...over });
const scenario = (budget: { p50?: number; p95: number }, extra: Record<string, unknown> = {}) => ({ label: 'x', budgets: { '10k': budget, '100k': budget }, ...extra });

describe('budgets.json', () => {
    it('is sound', () => {
        expect(budgetProblems(budgets)).toEqual([]);
    });

    it('names every decided scenario, and none above its decided budget (a budget only goes down)', () => {
        expect(Object.keys(budgets.scenarios).sort()).toEqual(Object.keys(DECIDED).sort());
        const above: string[] = [];
        for (const [id, shapes] of Object.entries(DECIDED)) {
            for (const shape of ['10k', '100k'] as const) {
                const b = budgets.scenarios[id]!.budgets[shape]!;
                const d = shapes[shape];
                if (b.p95 > d.p95) above.push(`${id} ${shape} p95`);
                if (d.p50 !== undefined && (b.p50 === undefined || b.p50 > d.p50)) above.push(`${id} ${shape} p50`);
            }
        }
        expect(above).toEqual([]);
        for (const [id, target] of Object.entries(DECIDED_BROWSER)) expect({ id, within: budgets.browser.scenarios[id]!.p95 <= target }).toEqual({ id, within: true });
        expect(budgets.tolerance).toBeLessThanOrEqual(0.25);
        expect(budgets.reruns).toBeLessThanOrEqual(1);
        expect(budgets.samples).toBeGreaterThanOrEqual(200);
        expect(budgets.browser.runs).toBeGreaterThanOrEqual(20);
    });

    it('keeps the two ratio rules of the map (detail 1.2x, a first page 1.5x)', () => {
        expect((budgets.ratios ?? []).map((r) => [r.scenario, r.metric, r.max])).toEqual([
            ['detail', 'p95', 1.2],
            ['list-project', 'p95', 1.5],
        ]);
    });

    it('refuses an unsound file', () => {
        expect(budgetProblems({ ...budgets, tolerance: 2 })).toContain('tolerance must be a fraction in [0, 1)');
        expect(budgetProblems({ ...budgets, scenarios: { a: { label: 'a', budgets: { '10k': { p95: 10 } } } } })).toContain('a: no budget for 100k');
        expect(budgetProblems({ ...budgets, scenarios: { a: scenario({ p50: 20, p95: 10 }) } })).toContain('a 10k: p50 must be positive and at most p95');
        expect(budgetProblems({ ...budgets, scenarios: { a: scenario({ p95: 10 }, { enforced: false }) } })).toContain('a: a scenario that is not enforced says why (reportedBecause)');
        expect(budgetProblems({ ...budgets, ratios: [{ scenario: 'nope', metric: 'p95', max: 1.2 }] })).toContain('ratio: unknown scenario nope');
    });

    it('run.mjs runs every scenario budgets.json names, and no other', () => {
        const body = functionBodyOf(runSource, 'scenarioRunners');
        const keys = [...body.matchAll(/^ {8}(?:'([a-z0-9-]+)'|([a-z][a-zA-Z0-9]*)):\s/gm)].map((m) => m[1] ?? m[2]);
        expect(keys.sort()).toEqual(Object.keys(budgets.scenarios).sort());
        const browserBody = functionBodyOf(runSource, 'runBrowser');
        const browserKeys = [...browserBody.matchAll(/^ {8}([a-z]+): async \(page\)/gm)].map((m) => m[1]);
        expect(browserKeys.sort()).toEqual(Object.keys(budgets.browser.scenarios).sort());
    });

    it('marks the writes, which run after every read so their rows and vacuum never sit under a read', () => {
        expect(Object.entries(budgets.scenarios).filter(([, b]) => b.write).map(([id]) => id).sort()).toEqual(['bulk-state', 'create', 'edit', 'move', 'reorder', 'time-add', 'time-off-set']);
        const main = runSource.slice(runSource.indexOf('// ── Main'));
        expect(main.indexOf('await runApi(world, false)')).toBeGreaterThan(0);
        expect(main.indexOf('await runApi(world, false)')).toBeLessThan(main.indexOf('await runBrowser('));
        expect(main.indexOf('await runBrowser(')).toBeLessThan(main.indexOf('await runApi(world, true)'));
    });

    it("signs in with the seed's own password", () => {
        const seed = fs.readFileSync(path.join(ROOT, 'scripts/seed-scale/workspace.ts'), 'utf8');
        const seedPassword = /export const SEED_PASSWORD = '([^']+)'/.exec(seed)?.[1];
        const harnessPassword = /export const SEED_PASSWORD = '([^']+)'/.exec(runSource)?.[1];
        expect(seedPassword).toBeDefined();
        expect(harnessPassword).toBe(seedPassword);
    });
});

describe('summarise', () => {
    it('reads percentiles from the samples', () => {
        const s = summarise(range(100));
        expect(s.count).toBe(100);
        expect(s.p50).toBeCloseTo(50, 0);
        expect(s.p95).toBeCloseTo(95, 0);
        expect(s.min).toBeCloseTo(1, 1);
        expect(s.max).toBeCloseTo(100, 0);
    });

    it('measures nothing from nothing', () => {
        expect(summarise([])).toEqual({ count: 0, p50: null, p95: null, p99: null, min: null, max: null, mean: null });
        expect(summarise([Number.NaN, -1]).count).toBe(0);
    });
});

describe('a run that measured nothing is refused (decision 168)', () => {
    it('refuses failed or signed-out samples, an empty histogram and a refused response', () => {
        expect(refusalsOf(attempt())).toEqual([]);
        expect(refusalsOf(attempt({ ok: 3, statuses: { 200: 3, 401: 197 } }))).toEqual(['3 of 200 samples succeeded (statuses: 200×3, 401×197)']);
        expect(refusalsOf(attempt({ ok: 0, statuses: {}, summary: summarise([]) }))).toEqual(['0 of 200 samples succeeded (statuses: none)', 'nothing was measured']);
        expect(refusalsOf(attempt({ problems: ['a list answered no rows'] }))).toEqual(['a list answered no rows']);
    });

    it('fails the run whatever the latency and whether or not budgets are enforced', () => {
        const scenarios: Record<string, ScenarioResult> = { a: { label: 'a', attempts: [attempt({ ok: 199 })] } };
        expect(verdictOf({ scenarios, enforce: false }).failed).toBe(true);
        expect(verdictOf({ scenarios, enforce: true }).refused.map((r) => r.id)).toEqual(['a']);
    });
});

describe('budgets with the tolerance and one re-run', () => {
    const s = scenario({ p50: 40, p95: 100 });

    it('judges each figure against its budget widened by the tolerance', () => {
        expect(judge(summaryOf(40, 100), s, '10k', 0.25)).toMatchObject({ missed: false, blocking: true });
        const within = judge(summaryOf(49, 124), s, '10k', 0.25);
        expect(within.missed).toBe(false);
        expect(within.checks.every((c) => !c.withinBudget)).toBe(true);
        const missed = judge(summaryOf(40, 126), s, '10k', 0.25);
        expect(missed.checks.filter((c) => !c.within).map((c) => [c.metric, c.limit])).toEqual([['p95', 125]]);
        expect(judge(summaryOf(40, 101), s, '10k', 0).missed).toBe(true);
    });

    it('fails an enforced run only when every attempt missed', () => {
        const miss = attempt({ verdict: judge(summaryOf(40, 200), s, '100k', 0.25) });
        const pass = attempt({ verdict: judge(summaryOf(40, 90), s, '100k', 0.25) });
        expect(verdictOf({ scenarios: { a: { label: 'a', attempts: [miss, miss] } }, enforce: true })).toMatchObject({ failed: true, missed: [{ id: 'a' }] });
        expect(verdictOf({ scenarios: { a: { label: 'a', attempts: [miss, pass] } }, enforce: true }).failed).toBe(false);
        // Reported only, never red, without --enforce (pull requests).
        expect(verdictOf({ scenarios: { a: { label: 'a', attempts: [miss] } }, enforce: false })).toMatchObject({ failed: false, missed: [{ id: 'a' }] });
    });

    it('reports a later gate\'s budget without failing the run', () => {
        const later = scenario({ p95: 100 }, { enforced: false, reportedBecause: 'H3' });
        const miss = attempt({ verdict: judge(summaryOf(40, 500), later, '100k', 0.25) });
        expect(verdictOf({ scenarios: { t: { label: 't', attempts: [miss] } }, enforce: true })).toMatchObject({ failed: false, reported: [{ id: 't' }] });
    });
});

describe('known findings (the twin of the plan checks\' knownFinding)', () => {
    const finding = { id: 'F9', shapes: ['100k'], why: 'a reported miss that is not yet fixed, for this test' };
    const s = scenario({ p50: 40, p95: 100 }, { knownFinding: finding });

    it('reports a known miss at its shape without failing the run, and is ordinary elsewhere', () => {
        expect(knownFindingAt(s, '100k')).toBe(finding);
        expect(knownFindingAt(s, '10k')).toBeNull();
        const miss = attempt({ verdict: judge(summaryOf(400, 900), s, '100k', 0.25) });
        expect(verdictOf({ scenarios: { q: { label: 'q', knownFinding: finding, attempts: [miss] } }, enforce: true })).toMatchObject({ failed: false, reported: [{ id: 'q', finding: 'F9' }] });
        const missAt10k = attempt({ verdict: judge(summaryOf(400, 900), s, '10k', 0.25) });
        expect(verdictOf({ scenarios: { q: { label: 'q', attempts: [missAt10k, missAt10k] } }, enforce: true }).failed).toBe(true);
    });

    it('fails the enforced run the day the finding no longer reproduces, until its marker is removed', () => {
        const fixed = attempt({ verdict: judge(summaryOf(30, 90), s, '100k', 0.25) });
        expect(verdictOf({ scenarios: { q: { label: 'q', knownFinding: finding, attempts: [fixed] } }, enforce: true })).toMatchObject({ failed: true, staleFindings: [{ id: 'q', finding: 'F9' }] });
    });

    it('says what it is', () => {
        expect(budgetProblems({ ...budgets, scenarios: { a: scenario({ p95: 10 }, { knownFinding: { id: 'F9', shapes: ['1m'], why: 'x' } }) } })).toContain('a: a known finding names its id, its shapes and why');
    });
});

describe('the ratio rules', () => {
    const rule = [{ scenario: 'detail', metric: 'p95' as const, max: 1.2 }];

    it('judges the 100k figure against the 10k one, with the tolerance', () => {
        expect(judgeRatios({ detail: { summary: summaryOf(20, 30) } }, { detail: { summary: summaryOf(20, 25) } }, rule, 0.25)[0]).toMatchObject({ judged: true, ratio: 1.2, limit: 1.5, within: true });
        expect(judgeRatios({ detail: { summary: summaryOf(20, 40) } }, { detail: { summary: summaryOf(20, 25) } }, rule, 0.25)[0]).toMatchObject({ judged: true, ratio: 1.6, within: false });
    });

    it('never passes a rule it could not judge', () => {
        const [r] = judgeRatios({ detail: { summary: summaryOf(20, 30) } }, {}, rule, 0.25);
        expect(r).toMatchObject({ judged: false, within: false });
        expect(verdictOf({ scenarios: {}, ratios: [r!], enforce: true }).failed).toBe(true);
        expect(verdictOf({ scenarios: {}, ratios: [r!], enforce: false }).failed).toBe(false);
    });
});

describe('the report', () => {
    it('puts every figure beside its budget and says why a run is red', () => {
        const s = scenario({ p50: 40, p95: 100 });
        const scenarios = {
            good: { label: 'Good', attempts: [attempt({ summary: summaryOf(30, 80), verdict: judge(summaryOf(30, 80), s, '10k', 0.25) })] },
            empty: { label: 'Empty', attempts: [attempt({ ok: 0, statuses: { 401: 200 }, summary: summarise([]) })] },
        };
        const verdict = verdictOf({ scenarios, enforce: false });
        const md = renderMarkdown({ shape: '10k', enforce: false, baseUrl: 'http://x', signedInAs: 'm', startedAt: 't', tolerance: 0.25, scenarios, ratios: [], verdict });
        expect(md).toContain('| Good | 200 | 30 | 40 | 80 | 100 | within budget |');
        expect(md).toContain('**refused**: 0 of 200 samples succeeded (statuses: 401×200); nothing was measured');
        expect(md).toContain('**Result: red.**');
    });
});
