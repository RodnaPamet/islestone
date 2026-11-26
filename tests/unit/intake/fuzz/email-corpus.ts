/**
 * The intake email seed corpus (Hardening H2f; docs/porting/maps/H2.md part 6):
 * the raw messages the email parsers' properties mutate. The recorded shapes
 * are files under `tests/fixtures/intake-email-corpus/` (written for
 * Islestone in the shapes the common clients send: Gmail, Outlook, Apple
 * Mail, a nested mixed/related/alternative message, a forwarded
 * `message/rfc822`, unknown charsets with bad base64 padding, bidirectional
 * controls and NUL bytes, an auto-reply and a bounce); the two that are large
 * by construction (1,000 parts, a 100 KB folded header) are built here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '..', '..', 'fixtures', 'intake-email-corpus');

/** A message of 1,000 parts, past the parser's 200. */
function thousandParts(): Uint8Array {
    let m = 'From: Many <many@example.com>\r\nSubject: A thousand parts\r\nContent-Type: multipart/mixed; boundary="p"\r\n\r\n';
    for (let i = 0; i < 1_000; i++) m += `--p\r\nContent-Type: ${i % 3 === 0 ? 'text/plain' : 'application/octet-stream'}\r\n\r\npart ${i}\r\n`;
    return Buffer.from(`${m}--p--\r\n`, 'latin1');
}

/** A `Subject` folded over 100 KB of continuation lines, and a `From` nearly as long. */
function foldedHeaders(): Uint8Array {
    const subject = Array.from({ length: 14_000 }, (_, i) => `word${i}`).join('\r\n ');
    const from = `"${'Ada '.repeat(10_000)}" <ada@example.com>`;
    return Buffer.from(`From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\nbody\r\n`, 'latin1');
}

export interface CorpusMessage {
    name: string;
    bytes: Uint8Array;
}

export function loadCorpus(): CorpusMessage[] {
    const files = readdirSync(DIR)
        .filter((f) => f.endsWith('.eml'))
        .sort()
        .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(DIR, name))) }));
    return [...files, { name: 'generated:1000-parts', bytes: thousandParts() }, { name: 'generated:folded-100kb', bytes: foldedHeaders() }];
}
