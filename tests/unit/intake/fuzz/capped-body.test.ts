/**
 * Property fuzzing of the capped body reader (Hardening H2f; docs/porting/maps/H2.md
 * part 6; `src/lib/intake/public/capped-body.ts`), the one way a public intake
 * route, the inbound email webhook and the raw-message download read a body.
 *
 * For any body, chunked anywhere, with any `Content-Length`:
 *   - a body within the cap is read whole;
 *   - a longer one is refused with the typed 413 before more than the cap and
 *     one chunk has been pulled, and the stream is cancelled;
 *   - the header decides nothing about what is accepted: a declared length
 *     within the cap, true or not, changes nothing, and one above the cap can
 *     only refuse early (413) with nothing pulled; a body over the cap is
 *     refused whatever the header claims;
 *   - invalid UTF-8 is refused with a typed 400, and nothing the reader does
 *     throws an untyped error.
 */
import fc from 'fast-check';

import { AppError } from '@/lib/errors/types';
import { readCappedBody, readCappedBytes, readCappedJson } from '@/lib/intake/public/capped-body';

import { assertFuzzAsync, fuzzTimeout } from '../../../helpers/fuzz';

interface Pulled {
    bytes: number;
    cancelled: boolean;
    maxChunk: number;
}

/** A body source whose stream hands out `chunks` one per pull, counting what was pulled. */
function source(chunks: Uint8Array[], contentLength: string | null): { src: { headers: Headers; body: ReadableStream<Uint8Array<ArrayBuffer>> }; pulled: Pulled } {
    const pulled: Pulled = { bytes: 0, cancelled: false, maxChunk: chunks.reduce((m, c) => Math.max(m, c.byteLength), 0) };
    let i = 0;
    // A high-water mark of zero: the stream pulls only when the reader asks,
    // so `pulled` counts what the reader itself took, not a read-ahead.
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
        {
            pull(controller) {
                if (i >= chunks.length) {
                    controller.close();
                    return;
                }
                const c = chunks[i++]!;
                pulled.bytes += c.byteLength;
                controller.enqueue(new Uint8Array(c));
            },
            cancel() {
                pulled.cancelled = true;
            },
        },
        { highWaterMark: 0 },
    );
    const headers = new Headers();
    if (contentLength !== null) headers.set('content-length', contentLength);
    return { src: { headers, body }, pulled };
}

/** Split `bytes` at the given cut points (each taken modulo the length), keeping empty chunks out. */
function split(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
    if (bytes.byteLength === 0) return [];
    const at = [...new Set(cuts.map((c) => c % bytes.byteLength).filter((c) => c > 0))].sort((a, b) => a - b);
    const out: Uint8Array[] = [];
    let from = 0;
    for (const c of [...at, bytes.byteLength]) {
        out.push(bytes.slice(from, c));
        from = c;
    }
    return out;
}

const isValidUtf8 = (b: Uint8Array) => {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(b);
        return true;
    } catch {
        return false;
    }
};

const capArb = fc.integer({ min: 0, max: 600 });
const bodyArb = fc.oneof(fc.uint8Array({ maxLength: 1_200 }), fc.string({ unit: 'binary', maxLength: 500 }).map((s) => new TextEncoder().encode(s)));
const cutsArb = fc.array(fc.nat(), { maxLength: 12 });

type Header = { kind: 'absent' } | { kind: 'true' } | { kind: 'value'; n: number } | { kind: 'raw'; raw: string };
/** The header: absent, the truth, a smaller or a larger lie, or not a number at all. */
const headerArb: fc.Arbitrary<Header> = fc.oneof(
    fc.constant<Header>({ kind: 'absent' }),
    fc.constant<Header>({ kind: 'true' }),
    fc.nat({ max: 2_000 }).map((n): Header => ({ kind: 'value', n })),
    fc.constantFrom('', 'abc', '-1', '1e3', ' 5', '5 ', '0x10', '99999999999999999999').map((raw): Header => ({ kind: 'raw', raw })),
);

function headerValue(h: Header, length: number): string | null {
    if (h.kind === 'absent') return null;
    if (h.kind === 'true') return String(length);
    if (h.kind === 'value') return String(h.n);
    return h.raw;
}

describe('the capped body reader (fuzzed)', () => {
    it(
        'reads a body within the cap whole, refuses a longer one early with the typed 413, and lets no header widen the cap',
        async () => {
            await assertFuzzAsync(
                fc.asyncProperty(bodyArb, cutsArb, capArb, headerArb, async (bytes, cuts, cap, header) => {
                    const declared = headerValue(header, bytes.byteLength);
                    const { src, pulled } = source(split(bytes, cuts), declared);
                    // As the reader sees it: a header value is trimmed when it is set.
                    const seen = src.headers.get('content-length');
                    const declaredOver = seen !== null && /^\d+$/.test(seen) && Number(seen) > cap;
                    let result: Uint8Array | AppError;
                    try {
                        result = await readCappedBytes(src, cap);
                    } catch (err) {
                        expect(err).toBeInstanceOf(AppError);
                        result = err as AppError;
                    }
                    if (declaredOver) {
                        // The free early refusal: a declared length above the cap, nothing read.
                        expect(result).toBeInstanceOf(AppError);
                        expect((result as AppError).status).toBe(413);
                        expect(pulled.bytes).toBe(0);
                    } else if (bytes.byteLength <= cap) {
                        expect(result).toBeInstanceOf(Uint8Array);
                        expect(Buffer.from(result as Uint8Array).equals(Buffer.from(bytes))).toBe(true);
                    } else {
                        expect(result).toBeInstanceOf(AppError);
                        expect((result as AppError).status).toBe(413);
                        expect((result as AppError).code).toBe('PAYLOAD_TOO_LARGE');
                        expect(pulled.bytes).toBeLessThanOrEqual(cap + pulled.maxChunk);
                        expect(pulled.cancelled).toBe(true);
                    }
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'decodes valid UTF-8 exactly, and refuses invalid UTF-8 with a typed 400, never an untyped error',
        async () => {
            await assertFuzzAsync(
                fc.asyncProperty(bodyArb, cutsArb, async (bytes, cuts) => {
                    const { src } = source(split(bytes, cuts), null);
                    try {
                        const text = await readCappedBody(src, 10_000);
                        expect(isValidUtf8(bytes)).toBe(true);
                        expect(text).toBe(new TextDecoder('utf-8').decode(bytes));
                    } catch (err) {
                        expect(err).toBeInstanceOf(AppError);
                        expect((err as AppError).status).toBe(400);
                        expect(isValidUtf8(bytes)).toBe(false);
                    }
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'parses JSON or refuses with a typed 400 or 413, for any bytes',
        async () => {
            const jsonish = fc.oneof(
                bodyArb,
                fc.json({ maxDepth: 6 }).map((s) => new TextEncoder().encode(s)),
                fc.nat({ max: 20_000 }).map((n) => new TextEncoder().encode(`${'['.repeat(n)}${']'.repeat(n)}`)),
            );
            await assertFuzzAsync(
                fc.asyncProperty(jsonish, cutsArb, async (bytes, cuts) => {
                    const { src } = source(split(bytes, cuts), null);
                    try {
                        await readCappedJson(src, 64 * 1024);
                    } catch (err) {
                        expect(err).toBeInstanceOf(AppError);
                        expect([400, 413]).toContain((err as AppError).status);
                    }
                }),
            );
        },
        fuzzTimeout(2),
    );
});

describe('the capped body reader: examples the fuzzing found (H2f)', () => {
    it('refuses invalid UTF-8 with a typed 400 instead of reading it as replacement characters (seed 661273824)', async () => {
        const { src } = source([Uint8Array.from([0x80])], null);
        await expect(readCappedBody(src, 10)).rejects.toMatchObject({ status: 400, code: 'INVALID_UTF8' });
        const json = source([Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])], null);
        await expect(readCappedJson(json.src, 100)).rejects.toMatchObject({ status: 400 });
    });
});
