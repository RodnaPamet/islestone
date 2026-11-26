/**
 * The latency harness's pure half (Hardening H2b; docs/performance.md,
 * "Latency"; owner decisions 166 to 169): percentiles, the budget verdicts,
 * the refusal of a run that measured nothing, and the report. No network, no
 * clock, no file system, so `tests/unit/perf/harness.test.ts` holds every
 * rule. `run.mjs` is the command line that drives the server and calls these.
 *
 * Written fresh for Islestone. inflect-compliance's `scripts/k6-summary-gate.mjs`
 * header (a month of green nightly runs in which almost every request was
 * signed out) is the lesson behind `refusalsOf`: pattern only, no code copied
 * (PROVENANCE.md).
 */
import { createHistogram } from 'node:perf_hooks';

/** The shapes a budget names (scripts/seed-scale/shapes.ts; `mini` is never measured). */
export const SHAPES = ['10k', '100k'];

/**
 * p50, p95, p99, min, max and mean of `samples` (milliseconds), through
 * `perf_hooks`' histogram at microsecond resolution. An empty list has no
 * percentiles: `count` 0 and every figure `null`, which `refusalsOf` refuses.
 */
export function summarise(samples) {
    const finite = samples.filter((s) => Number.isFinite(s) && s >= 0);
    if (finite.length === 0) return { count: 0, p50: null, p95: null, p99: null, min: null, max: null, mean: null };
    const h = createHistogram({ lowest: 1, highest: 3_600_000_000, figures: 3 });
    for (const s of finite) h.record(Math.max(1, Math.round(s * 1000)));
    const ms = (us) => Math.round(us / 10) / 100;
    return {
        count: finite.length,
        p50: ms(h.percentile(50)),
        p95: ms(h.percentile(95)),
        p99: ms(h.percentile(99)),
        min: ms(h.min),
        max: ms(h.max),
        mean: ms(h.mean),
    };
}

/**
 * Check `budgets.json` before anything runs: every scenario names a label and
 * a budget for both shapes, each budget a positive p95 (and a p50 when given,
 * never above its p95); the tolerance is a fraction; the ratio rules name a
 * known scenario. Returns the problems, empty when sound.
 */
export function budgetProblems(budgets) {
    const problems = [];
    if (!budgets || typeof budgets !== 'object') return ['budgets.json is not an object'];
    if (!(typeof budgets.tolerance === 'number' && budgets.tolerance >= 0 && budgets.tolerance < 1)) problems.push('tolerance must be a fraction in [0, 1)');
    if (!(Number.isInteger(budgets.reruns) && budgets.reruns >= 0 && budgets.reruns <= 3)) problems.push('reruns must be 0 to 3');
    for (const key of ['samples', 'warmup']) {
        if (!(Number.isInteger(budgets[key]) && budgets[key] > 0)) problems.push(`${key} must be a positive integer`);
    }
    const scenarios = budgets.scenarios ?? {};
    if (Object.keys(scenarios).length === 0) problems.push('no scenarios');
    for (const [id, s] of Object.entries(scenarios)) {
        if (typeof s.label !== 'string' || s.label.length === 0) problems.push(`${id}: no label`);
        for (const shape of SHAPES) {
            const b = s.budgets?.[shape];
            if (!b) {
                problems.push(`${id}: no budget for ${shape}`);
                continue;
            }
            if (!(typeof b.p95 === 'number' && b.p95 > 0)) problems.push(`${id} ${shape}: p95 must be a positive number`);
            if (b.p50 !== undefined && !(typeof b.p50 === 'number' && b.p50 > 0 && b.p50 <= b.p95)) problems.push(`${id} ${shape}: p50 must be positive and at most p95`);
        }
        for (const key of ['samples', 'warmup']) {
            if (s[key] !== undefined && !(Number.isInteger(s[key]) && s[key] > 0)) problems.push(`${id}: ${key} must be a positive integer`);
        }
        if (s.enforced === false && (typeof s.reportedBecause !== 'string' || s.reportedBecause.length === 0)) problems.push(`${id}: a scenario that is not enforced says why (reportedBecause)`);
        if (s.knownFinding !== undefined) {
            const f = s.knownFinding;
            if (!(typeof f.id === 'string' && f.id.length > 0 && Array.isArray(f.shapes) && f.shapes.length > 0 && f.shapes.every((x) => SHAPES.includes(x)) && typeof f.why === 'string' && f.why.length >= 20)) {
                problems.push(`${id}: a known finding names its id, its shapes and why`);
            }
        }
    }
    for (const r of budgets.ratios ?? []) {
        if (!scenarios[r.scenario]) problems.push(`ratio: unknown scenario ${r.scenario}`);
        if (!(typeof r.max === 'number' && r.max >= 1)) problems.push(`ratio ${r.scenario}: max must be at least 1`);
        if (!['p50', 'p95'].includes(r.metric)) problems.push(`ratio ${r.scenario}: metric must be p50 or p95`);
    }
    const browser = budgets.browser ?? {};
    if (!(Number.isInteger(browser.runs) && browser.runs > 0)) problems.push('browser.runs must be a positive integer');
    for (const [id, b] of Object.entries(browser.scenarios ?? {})) {
        if (typeof b.label !== 'string' || !(typeof b.p95 === 'number' && b.p95 > 0)) problems.push(`browser ${id}: a label and a positive p95 target`);
    }
    return problems;
}

/**
 * Why a scenario's measurement cannot be believed, whatever its latency
 * (map part 1.6): fewer successful samples than asked for (a failed or
 * signed-out request is not a sample), an empty histogram, or a response the
 * scenario's own check refused. Empty when the scenario measured something.
 */
export function refusalsOf(result) {
    const reasons = [];
    if (result.ok < result.samples) reasons.push(`${result.ok} of ${result.samples} samples succeeded (statuses: ${formatStatuses(result.statuses)})`);
    if (!result.summary || result.summary.count === 0) reasons.push('nothing was measured');
    for (const problem of result.problems ?? []) reasons.push(problem);
    return reasons;
}

function formatStatuses(statuses) {
    const entries = Object.entries(statuses ?? {});
    return entries.length === 0 ? 'none' : entries.map(([status, n]) => `${status}×${n}`).join(', ');
}

/**
 * A scenario's known finding at `shape`, or null: a miss reported and not
 * yet fixed (docs/performance.md, "Findings"), the harness's twin of the
 * plan checks' `knownFinding`.
 */
export function knownFindingAt(scenario, shape) {
    const f = scenario.knownFinding;
    return f && f.shapes.includes(shape) ? f : null;
}

/**
 * A scenario's measurement against its budget at `shape`. `limit` is the
 * budget widened by the tolerance (decision 168: 25 % on the nightly run);
 * a figure above its limit is a miss. A scenario whose budget belongs to a
 * later gate (`enforced: false`), or whose miss is a known finding at this
 * shape, is judged and reported, never a miss that fails the run
 * (`blocking: false`).
 */
export function judge(summary, scenario, shape, tolerance) {
    const budget = scenario.budgets[shape];
    const checks = [];
    for (const metric of ['p50', 'p95']) {
        if (budget[metric] === undefined) continue;
        const measured = summary[metric];
        const limit = round2(budget[metric] * (1 + tolerance));
        checks.push({ metric, measured, budget: budget[metric], limit, within: measured !== null && measured <= limit, withinBudget: measured !== null && measured <= budget[metric] });
    }
    const missed = checks.filter((c) => !c.within);
    return { checks, missed: missed.length > 0, blocking: scenario.enforced !== false && !knownFindingAt(scenario, shape) };
}

/**
 * The ratio rules (map part 1.4): the 100k figure against the 10k one, e.g.
 * the detail's p95 within 1.2× (it must not depend on the workspace's size)
 * and a list's first page within 1.5× (keyset pagination is nearly flat).
 * Judged with the same tolerance on the ratio. A rule whose baseline is
 * missing is reported as not judged, never as passed.
 */
export function judgeRatios(current, baseline, ratios, tolerance) {
    return ratios.map((r) => {
        const now = current?.[r.scenario]?.summary?.[r.metric] ?? null;
        const then = baseline?.[r.scenario]?.summary?.[r.metric] ?? null;
        if (now === null || then === null || then <= 0) return { ...r, judged: false, now, then, ratio: null, limit: round2(r.max * (1 + tolerance)), within: false };
        const ratio = round2(now / then);
        const limit = round2(r.max * (1 + tolerance));
        return { ...r, judged: true, now, then, ratio, limit, within: ratio <= limit };
    });
}

/**
 * The run's verdict. Refused scenarios (measured nothing) always fail, at
 * any shape and whether or not budgets are enforced (decision 168: "a run
 * that measured something" blocks every pull request). Budget misses and
 * ratio misses fail only when `enforce` is set (the nightly 100k run), and
 * only for a blocking scenario that missed on every attempt (one automatic
 * re-run, `attempts`).
 */
export function verdictOf({ scenarios, ratios = [], enforce }) {
    const refused = [];
    const missed = [];
    const reported = [];
    const staleFindings = [];
    for (const [id, s] of Object.entries(scenarios)) {
        const last = s.attempts[s.attempts.length - 1];
        if (s.attempts.some((a) => refusalsOf(a).length > 0)) {
            refused.push({ id, reasons: s.attempts.flatMap((a) => refusalsOf(a)) });
            continue;
        }
        // A known finding that measured within its budget is fixed: the marker comes off with the fix.
        if (s.knownFinding && last.verdict.checks.every((c) => c.withinBudget)) staleFindings.push({ id, finding: s.knownFinding.id });
        const allMissed = s.attempts.every((a) => a.verdict?.missed);
        if (!allMissed) continue;
        if (last.verdict.blocking) missed.push({ id, checks: last.verdict.checks.filter((c) => !c.within) });
        else reported.push({ id, checks: last.verdict.checks.filter((c) => !c.within), finding: s.knownFinding?.id });
    }
    const ratioMisses = ratios.filter((r) => !r.within);
    const failed = refused.length > 0 || (enforce && (missed.length > 0 || ratioMisses.length > 0 || staleFindings.length > 0));
    return { failed, refused, missed, reported, ratioMisses, staleFindings };
}

const round2 = (n) => Math.round(n * 100) / 100;

const fmt = (n) => (n === null || n === undefined ? '—' : String(n));

/** The job summary's Markdown: one table per part, every figure beside its budget. */
export function renderMarkdown(summary) {
    const lines = [];
    lines.push(`### Latency (${summary.shape}${summary.enforce ? ', budgets enforced' : ', reported'})`);
    lines.push('');
    lines.push(`Base URL ${summary.baseUrl}; signed in as ${summary.signedInAs}; ${summary.startedAt}. Tolerance ${Math.round(summary.tolerance * 100)} % on the nightly run, one re-run of a miss.`);
    lines.push('');
    lines.push('| Scenario | n | p50 ms | budget | p95 ms | budget | Verdict |');
    lines.push('|---|---:|---:|---:|---:|---:|---|');
    for (const s of Object.values(summary.scenarios)) {
        const a = s.attempts[s.attempts.length - 1];
        const p50 = a.verdict?.checks.find((c) => c.metric === 'p50');
        const p95 = a.verdict?.checks.find((c) => c.metric === 'p95');
        const refusal = refusalsOf(a);
        let verdict;
        if (refusal.length > 0) verdict = `**refused**: ${refusal.join('; ')}`;
        else if (!a.verdict.missed) verdict = a.verdict.checks.every((c) => c.withinBudget) ? 'within budget' : 'within tolerance';
        else if (a.verdict.blocking) verdict = '**missed**';
        else verdict = s.knownFinding ? `missed (known finding ${s.knownFinding.id})` : `missed (reported: ${s.reportedBecause ?? 'not enforced'})`;
        if (s.attempts.length > 1) verdict += ` (attempt ${s.attempts.length}; first p95 ${fmt(s.attempts[0].summary?.p95)})`;
        const extra = a.extra ? ` ${a.extra}` : '';
        lines.push(`| ${s.label}${extra} | ${a.summary?.count ?? 0} | ${fmt(a.summary?.p50)} | ${fmt(p50?.budget)} | ${fmt(a.summary?.p95)} | ${fmt(p95?.budget)} | ${verdict} |`);
    }
    if (summary.ratios?.length) {
        lines.push('');
        lines.push('| Ratio rule | 100k | 10k | ratio | max (with tolerance) | Verdict |');
        lines.push('|---|---:|---:|---:|---:|---|');
        for (const r of summary.ratios) {
            lines.push(`| ${r.scenario} ${r.metric} | ${fmt(r.now)} | ${fmt(r.then)} | ${fmt(r.ratio)} | ${r.max} (${r.limit}) | ${!r.judged ? 'not judged: no 10k baseline' : r.within ? 'within' : '**missed**'} |`);
        }
    }
    if (summary.concurrency) {
        const c = summary.concurrency;
        lines.push('');
        lines.push(`Concurrent pass (reported, not budgeted): ${c.clients} clients, ${c.requests} requests in ${c.seconds} s, ${c.throughput} requests/s, ${c.failed} failed.`);
        lines.push('');
        lines.push('| Scenario under load | n | p50 ms | p95 ms |');
        lines.push('|---|---:|---:|---:|');
        for (const [id, s] of Object.entries(c.scenarios)) lines.push(`| ${id} | ${s.count} | ${fmt(s.p50)} | ${fmt(s.p95)} |`);
    }
    if (summary.browser) {
        lines.push('');
        lines.push(`Browser timings (reported only, ${summary.browser.runs} runs each):`);
        lines.push('');
        lines.push('| Browser scenario | n | p50 ms | p95 ms | target p95 |');
        lines.push('|---|---:|---:|---:|---:|');
        for (const b of Object.values(summary.browser.scenarios)) {
            lines.push(`| ${b.label}${b.extra ? ` ${b.extra}` : ''} | ${b.summary?.count ?? 0} | ${fmt(b.summary?.p50)} | ${fmt(b.summary?.p95)} | ${b.target} |${b.error ? ` error: ${b.error}` : ''}`);
        }
    }
    const v = summary.verdict;
    lines.push('');
    if (v.refused.length) lines.push(`**Refused** (the run measured nothing for): ${v.refused.map((r) => r.id).join(', ')}.`);
    if (v.missed.length) lines.push(`**Missed${summary.enforce ? '' : ' (reported)'}:** ${v.missed.map((m) => m.id).join(', ')}.`);
    if (v.ratioMisses.length) lines.push(`**Ratio rules missed${summary.enforce ? '' : ' (reported)'}:** ${v.ratioMisses.map((r) => `${r.scenario} ${r.metric}`).join(', ')}.`);
    if (v.reported.length) lines.push(`Missed, reported (a known finding or a later gate's budget): ${v.reported.map((m) => (m.finding ? `${m.id} (${m.finding})` : m.id)).join(', ')}.`);
    if (v.staleFindings?.length) lines.push(`**Known findings that no longer reproduce** (remove the marker in budgets.json with the fix): ${v.staleFindings.map((f) => `${f.id} (${f.finding})`).join(', ')}.`);
    lines.push(v.failed ? '**Result: red.**' : 'Result: green.');
    lines.push('');
    return lines.join('\n');
}
