/**
 * The public intake form's in-house bot defence (sub-phase 2.6b; owner
 * decision 88): the signed form token, the proof-of-work, and the capped body
 * reader. Each refusal is exercised, and each acceptance, so a check that
 * stops checking fails here.
 */
import { createHash } from 'node:crypto';

import { leadingZeroBits, meetsDifficulty, powInput, solveProofOfWork } from '@/lib/intake/pow';
import { readCappedBody, readCappedJson } from '@/lib/intake/public/capped-body';
import { FORM_TOKEN_MAX_AGE_MS, FORM_TOKEN_MIN_AGE_MS, issueFormToken, verifyFormToken, verifyProofOfWork } from '@/lib/intake/public/form-token';

const FORM = 'AbCdEfGhIjKlMnOpQrStUv';
const OTHER = 'ZzZzZzZzZzZzZzZzZzZzZz';
const T0 = 1_800_000_000_000;

const nodeDigest = async (s: string) => new Uint8Array(createHash('sha256').update(s).digest());

describe('the signed form token', () => {
    it('verifies inside its window, for its form and version, and carries its nonce', () => {
        const token = issueFormToken(FORM, 3, T0);
        const ok = verifyFormToken(token, FORM, 3, T0 + FORM_TOKEN_MIN_AGE_MS);
        expect(ok).toMatchObject({ ok: true, definitionVersion: 3, issuedAt: T0 });
        expect(ok.ok && ok.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(verifyFormToken(token, FORM, 3, T0 + FORM_TOKEN_MAX_AGE_MS).ok).toBe(true);
    });

    it('refuses a form filled in under three seconds, and one older than a day', () => {
        const token = issueFormToken(FORM, 1, T0);
        expect(verifyFormToken(token, FORM, 1, T0 + FORM_TOKEN_MIN_AGE_MS - 1)).toEqual({ ok: false, reason: 'TOO_FAST' });
        expect(verifyFormToken(token, FORM, 1, T0 + FORM_TOKEN_MAX_AGE_MS + 1)).toEqual({ ok: false, reason: 'EXPIRED' });
    });

    it('refuses a token for another form, and an altered one', () => {
        const token = issueFormToken(FORM, 1, T0);
        expect(verifyFormToken(token, OTHER, 1, T0 + 5_000)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        const parts = token.split('.');
        const backdated = [parts[0], parts[1], String(T0 - 60_000), parts[3], parts[4]].join('.');
        expect(verifyFormToken(backdated, FORM, 1, T0 + 5_000)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
        const otherVersion = [parts[0], '2', parts[2], parts[3], parts[4]].join('.');
        expect(verifyFormToken(otherVersion, FORM, 2, T0 + 5_000)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('refuses a token minted for an older version of the form', () => {
        const token = issueFormToken(FORM, 1, T0);
        expect(verifyFormToken(token, FORM, 2, T0 + 5_000)).toEqual({ ok: false, reason: 'STALE_FORM' });
    });

    it('refuses anything that is not a token', () => {
        for (const bad of ['', 'v1', 'v2.1.2.3.4', 'x'.repeat(300), `v1.1.${T0}.short.mac`, `v1.a.${T0}.${'n'.repeat(22)}.mac`]) {
            expect(verifyFormToken(bad, FORM, 1, T0 + 5_000)).toEqual({ ok: false, reason: 'MALFORMED' });
        }
    });

    it('mints a fresh nonce every time', () => {
        const a = issueFormToken(FORM, 1, T0).split('.')[3];
        const b = issueFormToken(FORM, 1, T0).split('.')[3];
        expect(a).not.toBe(b);
    });
});

describe('the proof-of-work', () => {
    it('counts leading zero bits', () => {
        expect(leadingZeroBits(new Uint8Array([0, 0, 0x80]))).toBe(16);
        expect(leadingZeroBits(new Uint8Array([0, 0x01]))).toBe(15);
        expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
        expect(meetsDifficulty(new Uint8Array([0, 0x3f]), 10)).toBe(true);
        expect(meetsDifficulty(new Uint8Array([0, 0x40]), 10)).toBe(false);
    });

    it('a solution the solver finds is one the server accepts; the next counter is not, nor another token', async () => {
        const token = issueFormToken(FORM, 1, T0);
        const counter = await solveProofOfWork(token, nodeDigest, { bits: 10, yieldNow: async () => undefined });
        expect(counter).not.toBeNull();
        expect(verifyProofOfWork(token, counter, 10)).toBe(true);
        const other = issueFormToken(FORM, 1, T0);
        const digest = createHash('sha256').update(powInput(other, counter!)).digest();
        expect(verifyProofOfWork(other, counter, 10)).toBe(meetsDifficulty(digest, 10));
    });

    it('the default difficulty is solved and verified end to end', async () => {
        const token = issueFormToken(FORM, 1, T0);
        const counter = await solveProofOfWork(token, nodeDigest, { batch: 4096, yieldNow: async () => undefined });
        expect(verifyProofOfWork(token, counter)).toBe(true);
    });

    it('refuses a counter that is not a non-negative integer', () => {
        const token = issueFormToken(FORM, 1, T0);
        for (const bad of [-1, 1.5, '1', null, undefined, 2 ** 33, Number.NaN]) expect(verifyProofOfWork(token, bad, 0)).toBe(false);
    });

    it('stops when aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await solveProofOfWork('t', nodeDigest, { bits: 30, signal: controller.signal })).toBeNull();
    });
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let i = 0;
    return new ReadableStream({
        pull(controller) {
            if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
            else controller.close();
        },
    });
}

describe('the capped body reader', () => {
    it('reads a body under the cap', async () => {
        const req = new Request('http://x/', { method: 'POST', body: '{"a":1}' });
        await expect(readCappedJson(req, 100)).resolves.toEqual({ a: 1 });
    });

    it('refuses a declared length over the cap before reading', async () => {
        const req = new Request('http://x/', { method: 'POST', body: '{}', headers: { 'content-length': '5000' } });
        await expect(readCappedBody(req, 100)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    it('refuses an undeclared body the moment it passes the cap, without reading the rest', async () => {
        let pulled = 0;
        const enc = new TextEncoder();
        const endless = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulled++;
                controller.enqueue(enc.encode('x'.repeat(40)));
            },
        });
        const req = new Request('http://x/', { method: 'POST', body: endless, duplex: 'half' } as RequestInit);
        await expect(readCappedBody(req, 100)).rejects.toMatchObject({ status: 413 });
        expect(pulled).toBeLessThan(10);
    });

    it('a chunked body exactly at the cap is read; JSON it is not is a 400', async () => {
        const at = new Request('http://x/', { method: 'POST', body: streamOf(['"', 'x'.repeat(8), '"']), duplex: 'half' } as RequestInit);
        await expect(readCappedJson(at, 10)).resolves.toBe('xxxxxxxx');
        const notJson = new Request('http://x/', { method: 'POST', body: 'nope' });
        await expect(readCappedJson(notJson, 100)).rejects.toMatchObject({ status: 400 });
    });
});
