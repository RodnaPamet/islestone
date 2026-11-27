/**
 * The forecast's random numbers (sub-phase 3.6c; ADR 0014 §3; owner decision
 * 323): mulberry32, a 32-bit generator in integer arithmetic (`Math.imul`,
 * unsigned shifts), so one seed gives one stream on every JavaScript engine
 * and in every process time zone.
 *
 * Copied from inflect-compliance `src/lib/fair-math.ts` (`seededRng`, lines
 * 142 to 152, BUSL-1.1, the same licensor; PROVENANCE.md): the function only,
 * typed and renamed. Pure: no clock, no zone, no `Math.random`.
 */

/** A seeded generator of numbers in [0, 1); equal seeds give equal streams. */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
