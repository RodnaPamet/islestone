/**
 * Deterministic randomness for the scale seed (Hardening H2a, docs/performance.md).
 *
 * Every draw comes from a stream named by the seed string and a purpose
 * (`stream(seed, 'items:<projectKey>')`), so a run with the same seed and
 * shape produces the same workspaces, item for item, and adding a draw in one
 * part never shifts another part's numbers. The generator is sfc32 seeded
 * through a 128-bit hash of the name (cyrb128); both are public-domain
 * algorithms, written fresh here. Not for anything secret.
 */

/** cyrb128: four 32-bit words from a string. */
function cyrb128(text: string): [number, number, number, number] {
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < text.length; i++) {
        const k = text.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export interface Rng {
    /** A float in [0, 1). */
    next(): number;
    /** An integer in [min, max], both included. */
    int(min: number, max: number): number;
    /** True with probability `p`. */
    chance(p: number): boolean;
    /** One element, uniformly. */
    pick<T>(items: readonly T[]): T;
    /** One element by weight (the weights need not sum to 1). */
    weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
    /** `n` distinct elements (all of them when `n` is larger), in draw order. */
    sample<T>(items: readonly T[], n: number): T[];
    /** A deterministic id shaped like a cuid (25 characters, starts with `c`). */
    id(): string;
}

/** A named stream: the same `(seed, name)` always yields the same draws. */
export function stream(seed: string, name: string): Rng {
    let [a, b, c, d] = cyrb128(`${seed}\u0000${name}`);
    const next = (): number => {
        a >>>= 0;
        b >>>= 0;
        c >>>= 0;
        d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
    // Discard the first draws: sfc32's early output still shows its seed.
    for (let i = 0; i < 15; i++) next();
    const rng: Rng = {
        next,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        chance: (p) => next() < p,
        pick: (items) => {
            if (items.length === 0) throw new Error('pick from an empty list');
            return items[Math.floor(next() * items.length)]!;
        },
        weighted: (items) => {
            const total = items.reduce((s, [, w]) => s + w, 0);
            let r = next() * total;
            for (const [item, w] of items) {
                r -= w;
                if (r < 0) return item;
            }
            return items[items.length - 1]![0];
        },
        sample: (items, n) => {
            const pool = [...items];
            const out: (typeof items)[number][] = [];
            while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);
            return out;
        },
        id: () => {
            let s = 'c';
            while (s.length < 25) s += Math.floor(next() * 36).toString(36);
            return s;
        },
    };
    return rng;
}

/**
 * A Zipf sampler over ranks 0..n-1 (exponent `s`): rank 0 is drawn most, the
 * tail rarely, as assignees are in a real backlog (My Work has heavy and light
 * users). Built once per population; each draw is a binary search.
 */
export function zipf(n: number, s = 1.07): (rng: Rng) => number {
    if (n < 1) throw new Error('zipf over an empty population');
    const cdf = new Float64Array(n);
    let sum = 0;
    for (let k = 0; k < n; k++) {
        sum += 1 / Math.pow(k + 1, s);
        cdf[k] = sum;
    }
    return (rng) => {
        const r = rng.next() * sum;
        let lo = 0;
        let hi = n - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (cdf[mid]! < r) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
}
