/**
 * Property fuzzing's run size and replay (Hardening H2f; docs/porting/maps/H2.md
 * part 6; owner decision 178).
 *
 * A pull request runs each fuzz property at `FUZZ_DEFAULT_RUNS` (100); the
 * nightly workflow (`.github/workflows/perf.yml`, job `intake-fuzz`) sets
 * `FC_NUM_RUNS=20000`. A failure names its seed and path, and the same case
 * is replayed with them:
 *
 *   FC_SEED=<seed> FC_PATH=<path> npx jest tests/unit/intake/fuzz/<file>
 *
 * A seed found failing becomes an example test in the pull request that fixes
 * it (the map's rule), so the replay is for diagnosis, not for keeping.
 *
 * Written fresh for Islestone.
 */
import fc from 'fast-check';

export const FUZZ_DEFAULT_RUNS = 100;

function positiveInt(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`FC_NUM_RUNS must be a positive integer, not ${JSON.stringify(raw)}.`);
    return n;
}

/** The runs a fuzz property makes: `FC_NUM_RUNS`, else 100 (`scale` shrinks it for an expensive property). */
export function fuzzRuns(scale = 1): number {
    const runs = positiveInt(process.env.FC_NUM_RUNS) ?? FUZZ_DEFAULT_RUNS;
    return Math.max(1, Math.round(runs * scale));
}

/**
 * A Jest timeout that grows with the run count: `perRunMs` for each run,
 * three times over, and never under `floorMs`. The nightly's 20,000 runs need
 * minutes where a pull request's 100 need seconds.
 */
export function fuzzTimeout(perRunMs: number, scale = 1, floorMs = 20_000): number {
    return Math.max(floorMs, Math.ceil(fuzzRuns(scale) * perRunMs * 3));
}

function replayParameters(): Pick<fc.Parameters<unknown>, 'seed' | 'path'> {
    const seed = process.env.FC_SEED;
    if (seed === undefined || seed.trim() === '') return {};
    const n = Number(seed);
    if (!Number.isInteger(n)) throw new Error(`FC_SEED must be an integer, not ${JSON.stringify(seed)}.`);
    const path = process.env.FC_PATH;
    return path ? { seed: n, path } : { seed: n };
}

/**
 * Check `property` with the fuzz run size, and on a failure throw fast-check's
 * own report (the counterexample, the seed and the path) with the replay
 * command in front of it, so the nightly's log is enough to reproduce it.
 */
export function assertFuzz<Ts extends [unknown, ...unknown[]]>(property: fc.IProperty<Ts>, options: { scale?: number } = {}): void {
    const details = fc.check(property, { numRuns: fuzzRuns(options.scale), ...replayParameters() } as fc.Parameters<Ts>);
    if (!details.failed) return;
    throw new Error(`Fuzz property failed. Replay: FC_SEED=${details.seed} FC_PATH=${details.counterexamplePath ?? ''}\n${fc.defaultReportMessage(details)}${causeOf(details)}`);
}

/** The failing check's own message, so the log says what broke as well as where. */
function causeOf(details: { errorInstance?: unknown }): string {
    const e = details.errorInstance;
    if (e === undefined || e === null) return '';
    return `\nThe check that failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 4_000);
}

/** As `assertFuzz`, for an asynchronous property. */
export async function assertFuzzAsync<Ts extends [unknown, ...unknown[]]>(property: fc.IAsyncProperty<Ts>, options: { scale?: number } = {}): Promise<void> {
    const details = await fc.check(property, { numRuns: fuzzRuns(options.scale), ...replayParameters() } as fc.Parameters<Ts>);
    if (!details.failed) return;
    throw new Error(`Fuzz property failed. Replay: FC_SEED=${details.seed} FC_PATH=${details.counterexamplePath ?? ''}\n${(await fc.asyncDefaultReportMessage(details)) ?? ''}${causeOf(details)}`);
}

/**
 * How long `run` takes, in milliseconds, robust to a busy machine: for each
 * try, the smaller of the wall-clock time and this process's processor time
 * (`process.cpuUsage`). Other test workers on the machine stretch the
 * wall-clock time but not the processor time; the garbage collector's
 * parallel threads add to the processor time but not to the wall-clock
 * time; a catastrophic pattern (a regular expression that backtracks, a
 * quadratic loop) makes both large. The fastest of up to `attempts` tries,
 * retried only while over `budgetMs`, so a pause does not count either.
 */
export function bestTimeMs(run: () => unknown, budgetMs: number, attempts = 4): number {
    let best = Infinity;
    for (let i = 0; i < attempts; i++) {
        const cpu0 = process.cpuUsage();
        const wall0 = performance.now();
        run();
        const wall = performance.now() - wall0;
        const cpu = process.cpuUsage(cpu0);
        best = Math.min(best, wall, (cpu.user + cpu.system) / 1000);
        if (best <= budgetMs) break;
    }
    return best;
}
