/**
 * The forecast's seed (sub-phase 3.6c; ADR 0014 §3; owner decision 323): FNV-1a
 * (32-bit) over the canonical JSON of the forecast's inputs: the scope's key,
 * the day it is read on, the sample, the remaining count, the share and the
 * trial count. The same data on the same day gives the same seed on every
 * reload and every machine; a new completion gives a new seed, as it should.
 * The seed is shown with the forecast; tests and the back-test may pass their
 * own.
 *
 * Pure and client-safe. Written fresh for Islestone.
 */
import type { EpochDay } from '../schedule/calendar';

/**
 * JSON with every object's keys sorted, arrays in order, and only finite
 * numbers: one text per value whatever order its keys were written in.
 */
export function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new RangeError('canonicalJson: a number must be finite');
        return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    throw new TypeError(`canonicalJson: cannot encode a ${typeof value}`);
}

/** FNV-1a, 32 bits, over the text's UTF-8 bytes; an unsigned integer. */
export function fnv1a32(text: string): number {
    let h = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(text)) {
        h ^= byte;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export interface SeedInputs {
    /** The scope's key: its filters and the history it is based on, canonicalised. */
    scope: unknown;
    /** The day the forecast is read on (its "today"). */
    day: EpochDay;
    sample: readonly number[];
    remaining: number;
    share: number;
    trials: number;
}

/** The seed a forecast derives from its inputs (decision 323). */
export function forecastSeed(inputs: SeedInputs): number {
    return fnv1a32(canonicalJson({ scope: inputs.scope, day: inputs.day, sample: [...inputs.sample], remaining: inputs.remaining, share: inputs.share, trials: inputs.trials }));
}
