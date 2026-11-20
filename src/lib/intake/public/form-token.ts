/**
 * The signed form token a public intake form's page embeds (sub-phase 2.6b,
 * owner decision 88; docs/porting/maps/2.6.md "Bot defence").
 *
 *   v1.<definitionVersion>.<issuedAtMs>.<nonce>.<mac>
 *   mac = HMAC-SHA256(deriveSubkey('islestone-intake-form-token-v1'),
 *                     `<publicId>|v1.<definitionVersion>.<issuedAtMs>.<nonce>`)
 *
 * The submit refuses a token for another form, one whose MAC does not verify,
 * one older than a day, one younger than three seconds (a person does not
 * finish a form that fast), and one issued for an older version of the form.
 * Its nonce makes at most one request: `IntakeRequest.formTokenNonce` is
 * unique per workspace, so a replayed token's insert fails inside the
 * submit's own transaction (stronger than a cache entry: it cannot be
 * flushed, and it commits with the request).
 *
 * The proof-of-work (`src/lib/intake/pow.ts`) is verified here too, with
 * Node's SHA-256. Server-only. Written fresh for Islestone.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { INTAKE_POW_BITS, INTAKE_POW_MAX_COUNTER, meetsDifficulty, powInput } from '@/lib/intake/pow';
import { deriveSubkey } from '@/lib/security/encryption';

const PURPOSE = 'islestone-intake-form-token-v1';
export const FORM_TOKEN_MIN_AGE_MS = 3_000;
export const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NONCE = /^[A-Za-z0-9_-]{22}$/;

function mac(publicId: string, payload: string): Buffer {
    return createHmac('sha256', deriveSubkey(PURPOSE)).update(`${publicId}|${payload}`).digest();
}

export function issueFormToken(publicId: string, definitionVersion: number, now: number = Date.now()): string {
    const payload = `v1.${definitionVersion}.${now}.${randomBytes(16).toString('base64url')}`;
    return `${payload}.${mac(publicId, payload).toString('base64url')}`;
}

export type FormTokenRefusal = 'MALFORMED' | 'BAD_SIGNATURE' | 'TOO_FAST' | 'EXPIRED' | 'STALE_FORM';
export type FormTokenCheck =
    | { ok: true; nonce: string; definitionVersion: number; issuedAt: number }
    | { ok: false; reason: FormTokenRefusal };

/**
 * Verify `token` for the form `publicId` at `definitionVersion` (the form's
 * current one). A token for another form fails its MAC.
 */
export function verifyFormToken(token: string, publicId: string, definitionVersion: number, now: number = Date.now()): FormTokenCheck {
    if (typeof token !== 'string' || token.length > 200) return { ok: false, reason: 'MALFORMED' };
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') return { ok: false, reason: 'MALFORMED' };
    const [, versionRaw, issuedRaw, nonce, macRaw] = parts as [string, string, string, string, string];
    if (!/^\d{1,9}$/.test(versionRaw) || !/^\d{1,15}$/.test(issuedRaw) || !NONCE.test(nonce)) return { ok: false, reason: 'MALFORMED' };
    const given = Buffer.from(macRaw, 'base64url');
    const expected = mac(publicId, parts.slice(0, 4).join('.'));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };
    const issuedAt = Number(issuedRaw);
    const age = now - issuedAt;
    if (age < FORM_TOKEN_MIN_AGE_MS) return { ok: false, reason: 'TOO_FAST' };
    if (age > FORM_TOKEN_MAX_AGE_MS) return { ok: false, reason: 'EXPIRED' };
    const version = Number(versionRaw);
    if (version !== definitionVersion) return { ok: false, reason: 'STALE_FORM' };
    return { ok: true, nonce, definitionVersion: version, issuedAt };
}

/** Whether `counter` solves the proof-of-work for `token`. */
export function verifyProofOfWork(token: string, counter: unknown, bits: number = INTAKE_POW_BITS): boolean {
    if (typeof counter !== 'number' || !Number.isInteger(counter) || counter < 0 || counter > INTAKE_POW_MAX_COUNTER) return false;
    return meetsDifficulty(createHash('sha256').update(powInput(token, counter)).digest(), bits);
}
