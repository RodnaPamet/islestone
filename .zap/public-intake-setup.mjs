#!/usr/bin/env node
/**
 * The public intake requests the nightly ZAP baseline sends (Hardening H2f;
 * docs/porting/maps/H2.md part 6, "DAST"; `.zap/public-intake-hook.py`).
 *
 *   node .zap/public-intake-setup.mjs <base URL> <publicId> > zap-public-intake.json
 *
 * Reads the public form's page as a browser would, takes the signed form token
 * it embeds, solves its proof-of-work (`src/lib/intake/pow.ts`: SHA-256 of
 * `<token>:<counter>` with 14 leading zero bits) and writes the URLs and
 * bodies the hook passes through ZAP: the page, one valid submission, one the
 * server refuses (a token that does not verify), and a confirmation with a
 * made-up token. Exit 1 if the page holds no token, so the scan never runs on
 * less than it says. Written fresh for Islestone; node only, no dependency.
 */
import { createHash, randomBytes } from 'node:crypto';

const [base, publicId] = process.argv.slice(2);
if (!base || !/^[A-Za-z0-9_-]{22}$/.test(publicId ?? '')) {
    process.stderr.write('usage: node .zap/public-intake-setup.mjs <base URL> <publicId>\n');
    process.exit(2);
}

const POW_BITS = 14;
const TOKEN = /v1\.\d{1,9}\.\d{1,15}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/;

function leadingZeroBits(digest) {
    let bits = 0;
    for (const byte of digest) {
        if (byte === 0) {
            bits += 8;
            continue;
        }
        return bits + Math.clz32(byte) - 24;
    }
    return bits;
}

function solve(token) {
    for (let counter = 0; counter < 2 ** 32; counter++) {
        if (leadingZeroBits(createHash('sha256').update(`${token}:${counter}`).digest()) >= POW_BITS) return counter;
    }
    throw new Error('no proof-of-work counter found');
}

const page = `${base}/f/${publicId}`;
const res = await fetch(page);
const html = await res.text();
const token = TOKEN.exec(html)?.[0];
if (res.status !== 200 || !token) {
    process.stderr.write(`public-intake-setup: ${page} answered ${res.status} with no form token\n`);
    process.exit(1);
}

const submit = `${base}/api/intake/forms/${publicId}`;
const valid = { token, proof: solve(token), request: { title: 'A request the nightly scan sends', requesterName: 'DAST' } };
const refused = { token: `${token.slice(0, -2)}AA`, proof: 0, request: { title: 'Refused' } };
const confirm = { token: randomBytes(32).toString('base64url') };

process.stdout.write(
    `${JSON.stringify(
        {
            get: [page],
            post: [
                { url: submit, body: JSON.stringify(valid) },
                { url: submit, body: JSON.stringify(refused) },
                { url: `${base}/api/intake/confirm`, body: JSON.stringify(confirm) },
            ],
        },
        null,
        2,
    )}\n`,
);
