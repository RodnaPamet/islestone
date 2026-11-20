/**
 * The proof-of-work a public intake form asks of the browser (sub-phase 2.6b,
 * owner decision 88): find a counter such that SHA-256 of
 * `<form token>:<counter>` starts with `INTAKE_POW_BITS` zero bits. About
 * sixteen thousand hashes on average, around a second on a phone, solved while
 * the person types; negligible to a person, a real cost per request to a
 * script. The challenge is the signed form token itself, so a solution is
 * bound to one page load and spent with it.
 *
 * Client-safe and pure: the hash function is a parameter, so the page solves
 * with WebCrypto and the server verifies with Node's `crypto`
 * (`src/lib/intake/public/form-token.ts`). Written fresh for Islestone.
 */

export const INTAKE_POW_BITS = 14;
/** The largest counter the server accepts (a solution is found long before). */
export const INTAKE_POW_MAX_COUNTER = 2 ** 32 - 1;

export function powInput(token: string, counter: number): string {
    return `${token}:${counter}`;
}

/** The number of leading zero bits of a digest. */
export function leadingZeroBits(digest: Uint8Array): number {
    let bits = 0;
    for (const byte of digest) {
        if (byte === 0) {
            bits += 8;
            continue;
        }
        bits += Math.clz32(byte) - 24;
        break;
    }
    return bits;
}

export function meetsDifficulty(digest: Uint8Array, bits: number = INTAKE_POW_BITS): boolean {
    return leadingZeroBits(digest) >= bits;
}

/**
 * Find a counter for `token`, hashing in batches and yielding between them so
 * the page stays responsive. Resolves to `null` when `signal` aborts.
 */
export async function solveProofOfWork(
    token: string,
    digest: (input: string) => Promise<Uint8Array>,
    options: { bits?: number; batch?: number; signal?: AbortSignal; yieldNow?: () => Promise<void> } = {},
): Promise<number | null> {
    const bits = options.bits ?? INTAKE_POW_BITS;
    const batch = options.batch ?? 256;
    const yieldNow = options.yieldNow ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
    for (let counter = 0; counter <= INTAKE_POW_MAX_COUNTER; counter++) {
        if (options.signal?.aborted) return null;
        if (meetsDifficulty(await digest(powInput(token, counter)), bits)) return counter;
        if (counter % batch === batch - 1) await yieldNow();
    }
    return null;
}
