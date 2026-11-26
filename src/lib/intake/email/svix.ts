/**
 * Verify a Resend webhook delivery's Svix signature, by hand (sub-phase 2.6c,
 * owner decision 122). Resend signs each delivery the Svix way (re-check
 * against resend.com before go-live):
 *
 *   signed  = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   key     = base64-decode(secret without its `whsec_` prefix)
 *   expect  = base64(HMAC-SHA256(key, signed))
 *   header  `svix-signature`: a space-separated list of `v1,<base64>`; any
 *           one matching is enough (several are sent while a secret rotates),
 *           its text equal to `expect` exactly
 *
 * Refused outside five minutes either side of now (a replayed delivery), and
 * compared in constant time. Over the raw bytes exactly as received: the body
 * is never parsed before it is verified. Server-only; written fresh for
 * Islestone (no Svix library).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export type SvixRefusal = 'MISSING_HEADERS' | 'BAD_SECRET' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE';
export type SvixCheck = { ok: true } | { ok: false; reason: SvixRefusal };

export function svixSignature(secret: string, id: string, timestamp: string, rawBody: string): string {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    return createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
}

export function verifySvixSignature(input: {
    secret: string | undefined;
    id: string | null;
    timestamp: string | null;
    signature: string | null;
    rawBody: string;
    nowSeconds?: number;
}): SvixCheck {
    const { secret, id, timestamp, signature, rawBody } = input;
    if (!id || !timestamp || !signature) return { ok: false, reason: 'MISSING_HEADERS' };
    if (!secret || !secret.startsWith('whsec_') || secret.length < 12) return { ok: false, reason: 'BAD_SECRET' };
    if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'STALE_TIMESTAMP' };
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: 'STALE_TIMESTAMP' };
    // Compared as the base64 text Svix sends, never as decoded bytes: Node's
    // base64 decoder skips characters outside the alphabet, so a decoded
    // comparison accepted a signature with a character inserted (found by
    // Hardening H2f's fuzzing). Svix's own libraries compare the text too.
    const expected = Buffer.from(svixSignature(secret, id, timestamp, rawBody), 'utf8');
    for (const entry of signature.split(' ')) {
        const [version, value] = entry.split(',', 2);
        if (version !== 'v1' || !value) continue;
        const given = Buffer.from(value, 'utf8');
        if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
    }
    return { ok: false, reason: 'BAD_SIGNATURE' };
}
