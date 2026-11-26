// Types for scripts/perf/lib.mjs, so TypeScript tests can import it (tsconfig
// has allowJs off). This file declares the module's exports and nothing
// else; the behaviour lives in the .mjs and tests/unit/perf/harness.test.ts.

export interface Summary {
    count: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    min: number | null;
    max: number | null;
    mean: number | null;
}

export interface ShapeBudget {
    p50?: number;
    p95: number;
}

export interface ScenarioBudget {
    label: string;
    budgets: Record<string, ShapeBudget>;
    samples?: number;
    warmup?: number;
    enforced?: boolean;
    reportedBecause?: string;
    write?: boolean;
    knownFinding?: KnownFinding;
}

export interface KnownFinding {
    id: string;
    shapes: string[];
    why: string;
}

export interface Budgets {
    tolerance: number;
    reruns: number;
    samples: number;
    warmup: number;
    scenarios: Record<string, ScenarioBudget>;
    ratios?: Array<{ scenario: string; metric: 'p50' | 'p95'; max: number; why?: string }>;
    browser: { runs: number; scenarios: Record<string, { label: string; p95: number }> };
}

export interface Check {
    metric: 'p50' | 'p95';
    measured: number | null;
    budget: number;
    limit: number;
    within: boolean;
    withinBudget: boolean;
}

export interface Verdict {
    checks: Check[];
    missed: boolean;
    blocking: boolean;
}

export interface Attempt {
    samples: number;
    warmup?: number;
    ok: number;
    statuses: Record<string, number>;
    problems?: string[];
    summary: Summary;
    verdict: Verdict | null;
    extra?: string;
}

export interface ScenarioResult {
    label: string;
    reportedBecause?: string;
    knownFinding?: KnownFinding;
    attempts: Attempt[];
}

export interface RatioResult {
    scenario: string;
    metric: 'p50' | 'p95';
    max: number;
    judged: boolean;
    now: number | null;
    then: number | null;
    ratio: number | null;
    limit: number;
    within: boolean;
}

export interface RunVerdict {
    failed: boolean;
    refused: Array<{ id: string; reasons: string[] }>;
    missed: Array<{ id: string; checks: Check[] }>;
    reported: Array<{ id: string; checks: Check[]; finding?: string }>;
    ratioMisses: RatioResult[];
    staleFindings: Array<{ id: string; finding: string }>;
}

export declare const SHAPES: readonly string[];
export declare function summarise(samples: number[]): Summary;
export declare function budgetProblems(budgets: unknown): string[];
export declare function refusalsOf(result: Pick<Attempt, 'ok' | 'samples' | 'statuses' | 'summary' | 'problems'>): string[];
export declare function knownFindingAt(scenario: ScenarioBudget, shape: string): KnownFinding | null;
export declare function judge(summary: Summary, scenario: ScenarioBudget, shape: string, tolerance: number): Verdict;
export declare function judgeRatios(
    current: Record<string, { summary?: Summary }>,
    baseline: Record<string, { summary?: Summary }>,
    ratios: NonNullable<Budgets['ratios']>,
    tolerance: number,
): RatioResult[];
export declare function verdictOf(input: { scenarios: Record<string, ScenarioResult>; ratios?: RatioResult[]; enforce: boolean }): RunVerdict;
export declare function renderMarkdown(summary: Record<string, unknown>): string;
