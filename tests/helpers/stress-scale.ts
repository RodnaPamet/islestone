/**
 * The concurrency suite's scale (Hardening H2, part 2; issue #70; inflect-
 * compliance's `tests/stress/` shape, pattern only, no code copied).
 *
 * `STRESS_SCALE` (a whole number, 1 to 10; unset is 1) multiplies how many
 * rounds each race in `tests/integration/concurrency/` runs, each round on
 * fresh rows, and the time each test is given. A pull request runs at 1; the
 * nightly `concurrency-stress` job in `.github/workflows/perf.yml` runs at 4,
 * where a race that loses one round in forty shows.
 *
 * It never multiplies how many writers run at once: the stated limits
 * (`WORK_ITEM_CREATE_BURST_PER_PROJECT`, the pool) are what the suite
 * proves, and a burst past them fails by design, not by a defect.
 */

function readScale(raw: string | undefined): number {
    if (raw === undefined || raw === '') return 1;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error(`STRESS_SCALE must be a whole number from 1 to 10, not "${raw}"`);
    return n;
}

export const STRESS_SCALE = readScale(process.env.STRESS_SCALE);

/** `base` rounds, times the scale. */
export function rounds(base: number): number {
    return base * STRESS_SCALE;
}

/** The round numbers 1..rounds(base), for `it.each`. */
export function roundNumbers(base: number): number[] {
    return Array.from({ length: rounds(base) }, (_, i) => i + 1);
}

/** The time limit of a test whose own loop runs `rounds(…)`: the project's 30 s (or `baseMs`), times the scale. */
export function scaledTimeout(baseMs = 30_000): number {
    return baseMs * STRESS_SCALE;
}
