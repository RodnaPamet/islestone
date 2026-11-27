/**
 * Percentiles (sub-phase 3.6a; ADR 0014 §3): nearest rank everywhere, the one
 * definition 3.6 uses. The `p`-th percentile of `n` sorted values is the value
 * at index `ceil(p × n) − 1`. No interpolation, so every reported value is one
 * that happened.
 *
 * Pure. Written fresh for Islestone (inflect-compliance's `floor(p × (n − 1))`
 * is deliberately not used; docs/porting/maps/3.6.md, "What exists").
 */

/** The nearest-rank percentile of ascending `sorted` values; null for none. `p` in (0, 1]. */
export function nearestRank(sorted: readonly number[], p: number): number | null {
    if (sorted.length === 0) return null;
    if (!(p > 0 && p <= 1)) throw new RangeError(`nearestRank: p must be in (0, 1], got ${p}`);
    // A tiny tolerance keeps 0.85 × 20 = 17 (not 17.000000000000004) at rank 17.
    const rank = Math.max(1, Math.ceil(p * sorted.length - 1e-9));
    return sorted[rank - 1]!;
}

export interface PercentileSummary {
    count: number;
    p50: number | null;
    p85: number | null;
    p95: number | null;
}

/** The count and the 50th, 85th and 95th percentiles of `values` (any order). */
export function summarise(values: readonly number[]): PercentileSummary {
    const sorted = [...values].sort((a, b) => a - b);
    return { count: sorted.length, p50: nearestRank(sorted, 0.5), p85: nearestRank(sorted, 0.85), p95: nearestRank(sorted, 0.95) };
}
