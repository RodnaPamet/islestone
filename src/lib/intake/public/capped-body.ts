/**
 * Read a JSON body no larger than `maxBytes` (sub-phase 2.6b, the public
 * intake routes; docs/porting/maps/2.6.md "Size caps").
 *
 * Never `req.json()` or `req.text()` then a length check: both have already
 * read the whole body by the time it could be measured, which makes the cap a
 * report rather than a defence. `Content-Length` is a free early refusal, not
 * the check: it is a claim by the sender, and absent on a chunked body. The
 * stream is read chunk by chunk and cancelled the moment it passes the cap.
 *
 * Written fresh for Islestone.
 */
import { AppError, badRequest } from '@/lib/errors/types';

export function payloadTooLarge(maxBytes: number): AppError {
    return new AppError(`The request is larger than ${maxBytes} bytes.`, 'PAYLOAD_TOO_LARGE', 413);
}

/** Anything with a header list and a body stream: a request, or a fetched response (2.6c). */
export type BodySource = Pick<Request, 'headers' | 'body'>;

/** The body's bytes, refused (413) the moment they pass `maxBytes`. */
export async function readCappedBytes(source: BodySource, maxBytes: number): Promise<Uint8Array> {
    const declared = source.headers.get('content-length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw payloadTooLarge(maxBytes);
    if (!source.body) return new Uint8Array(0);
    const reader = source.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw payloadTooLarge(maxBytes);
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
    }
    return all;
}

export async function readCappedBody(source: BodySource, maxBytes: number): Promise<string> {
    return new TextDecoder('utf-8', { fatal: false }).decode(await readCappedBytes(source, maxBytes));
}

/** A capped body parsed as JSON; anything else is a 400. */
export async function readCappedJson(req: BodySource, maxBytes: number): Promise<unknown> {
    const text = await readCappedBody(req, maxBytes);
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw badRequest('The request body must be JSON.');
    }
}
